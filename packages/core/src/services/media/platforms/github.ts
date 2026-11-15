import type {
	GitHubMetaStore,
	GitHubRepoCommit,
	GitHubRepoCommitsStore,
	GitHubRepoMeta,
	GitHubRepoPR,
	GitHubRepoPRsStore,
	GitHubRepoSyncState,
	GitHubSyncState,
} from "@devpad/schema/media";
import { err, ok, pipe, type Result } from "@f0rbit/corpus";
import { Octokit } from "octokit";
import { GITHUB_DEFAULT_RATE_LIMIT, GITHUB_QUOTA_RESERVE_RATIO } from "../rate-limits";
import { createLogger } from "../../../utils/logger";
import { mapHttpError, type ProviderError, toProviderError } from "./types";

const log = createLogger("github");

export type GitHubProviderConfig = {
	maxRepos: number;
	maxCommitsPerRepo: number;
	maxPRsPerRepo: number;
	maxChangedReposPerRun: number;
	concurrency: number;
	prCommitConcurrency: number;
};

// Per-run ceilings (#163): the connected user's REST quota is shared with other
// OAuth apps, so fan-out stays bounded even on first-ever syncs.
const DEFAULT_CONFIG: GitHubProviderConfig = {
	maxRepos: 500,
	maxCommitsPerRepo: 500,
	maxPRsPerRepo: 200,
	maxChangedReposPerRun: 50,
	concurrency: 2,
	prCommitConcurrency: 2,
};

const PER_PAGE = 100;

export type GitHubRateLimitSnapshot = {
	remaining: number | null;
	limit_total: number | null;
	reset_at: string | null;
};

export type GitHubFetchInput = {
	sync_state: GitHubSyncState | null;
	previous_meta: GitHubMetaStore | null;
};

export type GitHubFetchResult = {
	meta: GitHubMetaStore;
	repos: Map<
		string,
		{
			commits: GitHubRepoCommitsStore;
			prs: GitHubRepoPRsStore;
		}
	>;
	// Repos whose commits AND PRs were fully fetched this run — only these may
	// advance their per-repo sync state.
	completed: string[];
	// Listed repos that made no GitHub calls this run (unchanged pushed_at,
	// over the per-run cap, or after a quota stop). Their stored data is kept.
	skipped: string[];
	rate_limit: GitHubRateLimitSnapshot;
	stopped_early: "quota_reserve" | "rate_limited" | null;
};

type OctokitResponse<T> = { data: T; status: number; headers: Record<string, unknown> };

type RepoData = {
	id: number;
	name: string;
	full_name: string;
	owner: { login: string };
	default_branch: string;
	private: boolean;
	fork: boolean;
	pushed_at: string | null;
	updated_at: string | null;
};

type BranchData = {
	name: string;
};

type CommitData = {
	sha: string;
	commit: {
		message: string;
		author: { name: string; email: string; date?: string } | null;
		committer: { name: string; email: string; date?: string } | null;
	};
	html_url: string;
	stats?: { additions?: number; deletions?: number };
	files?: unknown[];
};

type PRData = {
	id: number;
	number: number;
	title: string;
	body: string | null;
	state: "open" | "closed";
	html_url: string;
	created_at: string;
	updated_at: string;
	closed_at: string | null;
	merged_at: string | null;
	head: { ref: string };
	base: { ref: string };
	merge_commit_sha: string | null;
	user: { login: string; avatar_url?: string } | null;
	additions?: number;
	deletions?: number;
	changed_files?: number;
};

type PRCommitData = {
	sha: string;
};

const is_before = (iso: string, cutoff: string): boolean => new Date(iso).getTime() < new Date(cutoff).getTime();

const parse_header_number = (value: unknown): number | null => {
	const parsed = Number.parseInt(String(value), 10);
	return Number.isNaN(parsed) ? null : parsed;
};

const read_header = (headers: Record<string, unknown>, name: string): unknown =>
	headers[name] ?? headers[name.toLowerCase()];

const pool_map = async <T, R>(
	items: T[],
	concurrency: number,
	fn: (item: T) => Promise<R>,
	should_stop: () => boolean,
): Promise<Array<R | null>> => {
	const results: Array<R | null> = items.map(() => null);
	let next = 0;
	const worker = async (): Promise<void> => {
		while (next < items.length && !should_stop()) {
			const index = next;
			next = index + 1;
			results[index] = await fn(items[index]);
		}
	};
	await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
	return results;
};

const fetchAllPages = async <T>(
	fetcher: (page: number) => Promise<OctokitResponse<T[]>>,
	maxItems: number,
	should_stop: () => boolean = () => false,
): Promise<{ items: T[]; stopped_early: boolean }> => {
	const results: T[] = [];
	let page = 1;
	let stopped_early = false;

	while (results.length < maxItems) {
		if (should_stop()) {
			stopped_early = true;
			break;
		}
		const { data } = await fetcher(page);
		if (data.length === 0) break;
		results.push(...data);
		if (data.length < PER_PAGE) break;
		page++;
	}

	return { items: results.slice(0, maxItems), stopped_early };
};

const empty_commits = (repoMeta: GitHubRepoMeta): GitHubRepoCommitsStore => ({
	owner: repoMeta.owner,
	repo: repoMeta.name,
	branches: repoMeta.branches,
	commits: [],
	total_commits: 0,
	fetched_at: new Date().toISOString(),
});

const empty_prs = (repoMeta: GitHubRepoMeta): GitHubRepoPRsStore => ({
	owner: repoMeta.owner,
	repo: repoMeta.name,
	pull_requests: [],
	total_prs: 0,
	fetched_at: new Date().toISOString(),
});

type QuotaTracker = {
	record: (headers: Record<string, unknown>, status?: number) => void;
	should_stop: () => boolean;
	is_below_reserve: () => boolean;
	is_hard_limited: () => boolean;
	snapshot: () => GitHubRateLimitSnapshot;
};

const createQuotaTracker = (): QuotaTracker => {
	let remaining: number | null = null;
	let limit_total: number | null = null;
	let reset_at: string | null = null;
	let hard_limited = false;

	const is_below_reserve = (): boolean => {
		if (remaining === null) return false;
		const limit = limit_total ?? GITHUB_DEFAULT_RATE_LIMIT;
		if (limit <= 0) return false;
		return remaining < limit * GITHUB_QUOTA_RESERVE_RATIO;
	};

	return {
		record: (headers, status) => {
			const nextRemaining = parse_header_number(read_header(headers, "x-ratelimit-remaining"));
			const nextLimit = parse_header_number(read_header(headers, "x-ratelimit-limit"));
			const resetEpoch = parse_header_number(read_header(headers, "x-ratelimit-reset"));
			if (nextRemaining !== null) remaining = nextRemaining;
			if (nextLimit !== null) limit_total = nextLimit;
			if (resetEpoch !== null) reset_at = new Date(resetEpoch * 1000).toISOString();
			if (status === 429 || (status === 403 && remaining === 0) || remaining === 0) hard_limited = true;
		},
		is_hard_limited: () => hard_limited,
		is_below_reserve,
		should_stop: () => hard_limited || is_below_reserve(),
		snapshot: (): GitHubRateLimitSnapshot => ({ remaining, limit_total, reset_at }),
	};
};

class ProviderErrorSignal extends Error {
	constructor(readonly provider_error: ProviderError) {
		super("provider_error");
	}
}

const mapOctokitError = (error: unknown): ProviderError => {
	if (error && typeof error === "object" && "status" in error) {
		const status = (error as { status: number }).status;
		const response = (error as { response?: { headers?: Record<string, string | number> } }).response;
		const message = (error as { message?: string }).message ?? "Unknown API error";

		return mapHttpError(status, message, response?.headers);
	}

	return toProviderError(error);
};

type RepoPlanItem = {
	repo: GitHubRepoMeta;
	since: string | null;
};

type RepoOutcome =
	| {
			status: "fetched";
			repo: GitHubRepoMeta;
			commits: GitHubRepoCommitsStore;
			prs: GitHubRepoPRsStore;
			completed: boolean;
	  }
	| { status: "deferred" | "aborted"; repo: GitHubRepoMeta };

export class GitHubProvider {
	readonly platform = "github";
	private readonly config: GitHubProviderConfig;
	private readonly fetchImpl?: typeof fetch;

	constructor(config: Partial<GitHubProviderConfig> = {}, fetchImpl?: typeof fetch) {
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.fetchImpl = fetchImpl;
	}

	async fetch(
		token: string,
		input: GitHubFetchInput = { sync_state: null, previous_meta: null },
	): Promise<Result<GitHubFetchResult, ProviderError>> {
		log.debug("Starting fetch", { maxRepos: this.config.maxRepos });

		return pipe
			.try(
				async () => {
					const tracker = createQuotaTracker();
					const octokit = this.createOctokit(token, tracker);

					const userResult = await this.fetchUser(octokit);
					if (!userResult.ok) throw new ProviderErrorSignal(userResult.error);
					const username = userResult.value;
					log.info("Authenticated as", username);

					const reposResult = await this.fetchRepos(octokit, tracker);
					if (!reposResult.ok) throw new ProviderErrorSignal(reposResult.error);
					const freshMetas = reposResult.value.repos
						.filter((repo) => !repo.fork)
						.map((repo) => this.toRepoMeta(repo, [repo.default_branch]));
					const listedRepos = reposResult.value.truncated
						? this.carryUnlistedRepos(freshMetas, input.previous_meta)
						: freshMetas;
					log.debug("Found repos", { count: listedRepos.length });

					const plan = this.planSync(listedRepos, input);
					const outcomes = await pool_map(
						plan.toFetch,
						this.config.concurrency,
						(item) => this.fetchRepoData(octokit, username, item, input, tracker),
						() => tracker.should_stop(),
					);

					const unprocessed = plan.toFetch
						.filter((_, index) => outcomes[index] === null)
						.map((item) => item.repo.full_name);
					const abortedOrDeferred = outcomes
						.filter(
							(o): o is { status: "deferred" | "aborted"; repo: GitHubRepoMeta } =>
								o !== null && o.status !== "fetched",
						)
						.map((o) => o.repo.full_name);
					const skipped = [...plan.unchanged, ...plan.deferred, ...unprocessed, ...abortedOrDeferred];

					const { meta, repos, completed } = this.assembleResult(username, listedRepos, outcomes, input);
					log.info("Fetch complete", {
						listed: listedRepos.length,
						fetched: completed.length,
						skipped: skipped.length,
						stopped_early: tracker.is_hard_limited()
							? "rate_limited"
							: tracker.is_below_reserve()
								? "quota_reserve"
								: null,
					});

					return {
						meta,
						repos,
						completed,
						skipped,
						rate_limit: tracker.snapshot(),
						stopped_early: tracker.is_hard_limited()
							? "rate_limited"
							: tracker.is_below_reserve()
								? "quota_reserve"
								: null,
					};
				},
				(error): ProviderError => {
					if (error instanceof ProviderErrorSignal) {
						return error.provider_error;
					}
					log.error("Fetch failed", error);
					return mapOctokitError(error);
				},
			)
			.result();
	}

	private createOctokit(token: string, tracker: QuotaTracker): Octokit {
		const octokit = new Octokit({
			auth: token,
			userAgent: "media-timeline/2.0.0",
			throttle: { enabled: false },
			retry: { enabled: false },
			...(this.fetchImpl ? { request: { fetch: this.fetchImpl } } : {}),
		});

		octokit.hook.wrap("request", async (request, options) => {
			try {
				const response = (await request(options)) as OctokitResponse<unknown>;
				tracker.record(response.headers, response.status);
				return response;
			} catch (error) {
				const response = (error as { response?: OctokitResponse<unknown> }).response;
				if (response) tracker.record(response.headers, response.status);
				throw error;
			}
		});

		return octokit;
	}

	// Which listed repos need GitHub calls this run. Unchanged repos (stored
	// pushed_at matches the list response) make zero calls; changed repos are
	// capped per run so an overflow waits for the next tick instead of bursting.
	private planSync(
		listedRepos: GitHubRepoMeta[],
		input: GitHubFetchInput,
	): { toFetch: RepoPlanItem[]; unchanged: string[]; deferred: string[] } {
		const state: Partial<Record<string, GitHubRepoSyncState>> = input.sync_state?.repos ?? {};
		let budget = this.config.maxChangedReposPerRun;
		const toFetch: RepoPlanItem[] = [];
		const unchanged: string[] = [];
		const deferred: string[] = [];

		for (const repo of listedRepos) {
			const prev = state[repo.full_name];
			if (prev && prev.pushed_at === (repo.pushed_at ?? null)) {
				unchanged.push(repo.full_name);
				continue;
			}
			if (budget <= 0) {
				deferred.push(repo.full_name);
				continue;
			}
			budget--;
			toFetch.push({ repo, since: prev?.synced_at ?? null });
		}

		return { toFetch, unchanged, deferred };
	}

	private async fetchUser(octokit: Octokit): Promise<Result<string, ProviderError>> {
		try {
			const { data: user } = await octokit.rest.users.getAuthenticated();
			return ok(user.login);
		} catch (error) {
			return err(mapOctokitError(error));
		}
	}

	private async fetchRepos(
		octokit: Octokit,
		tracker: QuotaTracker,
	): Promise<Result<{ repos: RepoData[]; truncated: boolean }, ProviderError>> {
		try {
			const { items: repos, stopped_early: truncated } = await fetchAllPages<RepoData>(
				(page) =>
					octokit.rest.repos.listForAuthenticatedUser({
						sort: "pushed",
						direction: "desc",
						per_page: PER_PAGE,
						page,
					}),
				this.config.maxRepos,
				() => tracker.should_stop(),
			);

			log.debug("Fetched repos", { total: repos.length, truncated });
			return ok({ repos, truncated });
		} catch (error) {
			log.error("Failed to fetch repos", error);
			return err(mapOctokitError(error));
		}
	}

	// A quota stop mid repo-list pagination yields a truncated list. Carry the
	// previous meta's entries for unlisted repos forward so their already-synced
	// stores stay visible to the timeline instead of vanishing for a cycle.
	private carryUnlistedRepos(fresh: GitHubRepoMeta[], previous: GitHubMetaStore | null): GitHubRepoMeta[] {
		const listed = new Set(fresh.map((r) => r.full_name));
		const carried = (previous?.repositories ?? []).filter((r) => !listed.has(r.full_name));
		return [...fresh, ...carried];
	}

	private toRepoMeta(repo: RepoData, branches: string[]): GitHubRepoMeta {
		return {
			owner: repo.owner.login,
			name: repo.name,
			full_name: repo.full_name,
			default_branch: repo.default_branch,
			branches,
			is_private: repo.private,
			pushed_at: repo.pushed_at,
			updated_at: repo.updated_at ?? new Date().toISOString(),
		};
	}

	private async fetchBranches(octokit: Octokit, owner: string, repo: string): Promise<Result<string[], ProviderError>> {
		try {
			const { data: branches } = (await octokit.rest.repos.listBranches({
				owner,
				repo,
				per_page: PER_PAGE,
			})) as OctokitResponse<BranchData[]>;
			return ok(branches.map((b) => b.name));
		} catch (error) {
			return err(mapOctokitError(error));
		}
	}

	private async resolveBranches(
		octokit: Octokit,
		repo: GitHubRepoMeta,
		prev: GitHubRepoMeta | undefined,
	): Promise<string[]> {
		const fetched = await this.fetchBranches(octokit, repo.owner, repo.name);
		if (fetched.ok && fetched.value.length > 0) return fetched.value;
		if (prev && prev.branches.length > 0) return prev.branches;
		return [repo.default_branch];
	}

	private async fetchRepoData(
		octokit: Octokit,
		username: string,
		item: RepoPlanItem,
		input: GitHubFetchInput,
		tracker: QuotaTracker,
	): Promise<RepoOutcome> {
		const { repo, since } = item;
		const prev = input.previous_meta?.repositories.find((r) => r.full_name === repo.full_name);

		const branches = await this.resolveBranches(octokit, repo, prev);
		if (tracker.is_hard_limited()) {
			return { status: "aborted", repo: { ...repo, branches } };
		}
		const repoMeta: GitHubRepoMeta = { ...repo, branches };

		try {
			// Sequential within a repo so a quota stop recorded by the commits
			// fetch deterministically gates the PRs fetch (no mid-repo fan-out).
			const commitsResult = await this.fetchRepoCommits(octokit, repoMeta, username, since, tracker);
			const prsResult = await this.fetchRepoPRs(octokit, repoMeta, username, since, tracker);

			const commits = commitsResult.ok ? commitsResult.value : empty_commits(repoMeta);
			const prs = prsResult.ok ? prsResult.value : empty_prs(repoMeta);

			return {
				status: "fetched",
				repo: repoMeta,
				commits,
				prs,
				completed: commitsResult.ok && prsResult.ok && !tracker.should_stop(),
			};
		} catch (error) {
			log.warn("Repo fetch aborted", { repo: repo.full_name, error });
			return { status: "aborted", repo: repoMeta };
		}
	}

	private async fetchRepoCommits(
		octokit: Octokit,
		repoMeta: GitHubRepoMeta,
		username: string,
		since: string | null,
		tracker: QuotaTracker,
	): Promise<Result<GitHubRepoCommitsStore, ProviderError>> {
		const { owner, name, branches } = repoMeta;
		const commitMap = new Map<string, GitHubRepoCommit>();

		for (const branch of branches) {
			if (tracker.is_hard_limited()) break;
			try {
				const { items: branchCommits } = await fetchAllPages<CommitData>(
					(page) =>
						octokit.rest.repos.listCommits({
							owner,
							repo: name,
							sha: branch,
							author: username,
							...(since ? { since } : {}),
							per_page: PER_PAGE,
							page,
						}) as Promise<OctokitResponse<CommitData[]>>,
					this.config.maxCommitsPerRepo,
					() => tracker.should_stop(),
				);

				for (const commit of branchCommits) {
					if (commitMap.has(commit.sha)) continue;

					const authorDate = commit.commit.author?.date ?? commit.commit.committer?.date ?? new Date().toISOString();
					const committerDate = commit.commit.committer?.date ?? commit.commit.author?.date ?? new Date().toISOString();

					commitMap.set(commit.sha, {
						sha: commit.sha,
						message: commit.commit.message,
						author_name: commit.commit.author?.name ?? "Unknown",
						author_email: commit.commit.author?.email ?? "",
						author_date: authorDate,
						committer_name: commit.commit.committer?.name ?? "Unknown",
						committer_email: commit.commit.committer?.email ?? "",
						committer_date: committerDate,
						url: commit.html_url,
						branch,
						additions: commit.stats?.additions,
						deletions: commit.stats?.deletions,
						files_changed: commit.files?.length,
					});
				}
			} catch (error) {
				const mapped = mapOctokitError(error);
				// A real rate-limit hit must surface so the run stops and the repo
				// stays incomplete (state not advanced), not silently drop branches.
				if (mapped.kind === "rate_limited") throw new ProviderErrorSignal(mapped);
				log.warn("Failed to fetch commits for branch", { owner, repo: name, branch, error });
			}
		}

		return ok({
			owner,
			repo: name,
			branches,
			commits: Array.from(commitMap.values()),
			total_commits: commitMap.size,
			fetched_at: new Date().toISOString(),
		});
	}

	// PR list pagination stops at the first PR whose updated_at predates the
	// repo's last sync — listCommits is then only spent on re-fetched PRs.
	private async fetchRepoPRs(
		octokit: Octokit,
		repoMeta: GitHubRepoMeta,
		username: string,
		since: string | null,
		tracker: QuotaTracker,
	): Promise<Result<GitHubRepoPRsStore, ProviderError>> {
		const { owner, name } = repoMeta;

		try {
			const collected: PRData[] = [];
			let page = 1;
			let done = false;

			while (!done && collected.length < this.config.maxPRsPerRepo && !tracker.should_stop()) {
				const { data } = (await octokit.rest.pulls.list({
					owner,
					repo: name,
					state: "all",
					sort: "updated",
					direction: "desc",
					per_page: PER_PAGE,
					page,
				})) as OctokitResponse<PRData[]>;

				if (data.length === 0) break;
				for (const pr of data) {
					if (since && is_before(pr.updated_at, since)) {
						done = true;
						break;
					}
					collected.push(pr);
					if (collected.length >= this.config.maxPRsPerRepo) {
						done = true;
						break;
					}
				}
				if (!done && data.length < PER_PAGE) done = true;
				page++;
			}

			const userPRs = collected.filter((pr) => pr.user?.login.toLowerCase() === username.toLowerCase());

			const prsWithCommits = await pool_map(
				userPRs,
				this.config.prCommitConcurrency,
				async (pr): Promise<GitHubRepoPR> => {
					const commitsResult = await this.fetchPRCommits(octokit, owner, name, pr.number);
					const commitShas = commitsResult.ok ? commitsResult.value : [];
					const state = pr.merged_at ? "merged" : pr.state;

					return {
						id: pr.id,
						number: pr.number,
						title: pr.title,
						body: pr.body,
						state,
						url: pr.html_url,
						created_at: pr.created_at,
						updated_at: pr.updated_at,
						closed_at: pr.closed_at,
						merged_at: pr.merged_at,
						head_ref: pr.head.ref,
						base_ref: pr.base.ref,
						commit_shas: commitShas,
						merge_commit_sha: pr.merge_commit_sha,
						author_login: pr.user?.login ?? "unknown",
						author_avatar_url: pr.user?.avatar_url,
						additions: pr.additions,
						deletions: pr.deletions,
						changed_files: pr.changed_files,
					};
				},
				() => tracker.should_stop(),
			);

			return ok({
				owner,
				repo: name,
				pull_requests: prsWithCommits.filter((pr): pr is GitHubRepoPR => pr !== null),
				total_prs: prsWithCommits.filter((pr): pr is GitHubRepoPR => pr !== null).length,
				fetched_at: new Date().toISOString(),
			});
		} catch (error) {
			return err(mapOctokitError(error));
		}
	}

	private async fetchPRCommits(
		octokit: Octokit,
		owner: string,
		repo: string,
		prNumber: number,
	): Promise<Result<string[], ProviderError>> {
		try {
			const { data: commits } = (await octokit.rest.pulls.listCommits({
				owner,
				repo,
				pull_number: prNumber,
				per_page: 250,
			})) as OctokitResponse<PRCommitData[]>;
			return ok(commits.map((c) => c.sha));
		} catch (error) {
			return err(mapOctokitError(error));
		}
	}

	private assembleResult(
		username: string,
		listedRepos: GitHubRepoMeta[],
		outcomes: Array<RepoOutcome | null>,
		input: GitHubFetchInput,
	): {
		meta: GitHubMetaStore;
		repos: Map<string, { commits: GitHubRepoCommitsStore; prs: GitHubRepoPRsStore }>;
		completed: string[];
	} {
		const prevByFullName = new Map((input.previous_meta?.repositories ?? []).map((r) => [r.full_name, r]));
		const branchesByFullName = new Map<string, string[]>();

		for (const outcome of outcomes) {
			if (!outcome) continue;
			branchesByFullName.set(outcome.repo.full_name, outcome.repo.branches);
		}

		const repos = new Map<string, { commits: GitHubRepoCommitsStore; prs: GitHubRepoPRsStore }>();
		const completed: string[] = [];
		for (const outcome of outcomes) {
			if (outcome?.status !== "fetched") continue;
			repos.set(outcome.repo.full_name, { commits: outcome.commits, prs: outcome.prs });
			if (outcome.completed) completed.push(outcome.repo.full_name);
		}

		const repositories = listedRepos.map((repo) => {
			const resolved = branchesByFullName.get(repo.full_name);
			if (resolved) return { ...repo, branches: resolved };
			const prev = prevByFullName.get(repo.full_name);
			return prev && prev.branches.length > 0 ? { ...repo, branches: prev.branches } : repo;
		});

		const meta: GitHubMetaStore = {
			username,
			repositories,
			total_repos_available: listedRepos.length,
			repos_fetched: repositories.length,
			fetched_at: new Date().toISOString(),
		};

		return { meta, repos, completed };
	}
}
