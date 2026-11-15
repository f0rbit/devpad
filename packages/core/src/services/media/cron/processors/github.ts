import type {
	GitHubMetaStore,
	GitHubRepoCommitsStore,
	GitHubRepoPRsStore,
	GitHubRepoSyncState,
	GitHubSyncState,
} from "@devpad/schema/media";
import type { Backend } from "@f0rbit/corpus";
import { err, ok, pipe, type Result, to_nullable } from "@f0rbit/corpus";
import { createLogger } from "../../../../utils/logger";
import { mergeByKey } from "../../merge";
import type { GitHubFetchInput, GitHubFetchResult, GitHubRateLimitSnapshot } from "../../platforms/github";
import type { ProviderError } from "../../platforms/types";
import { store } from "../../storage";
import { formatFetchError, storeMeta as genericStoreMeta, type ProcessError } from "../platform-processor";

const log = createLogger("cron:github");

export type GitHubProcessResult = {
	account_id: string;
	meta_version: string;
	commit_stores: Array<{ owner: string; repo: string; version: string }>;
	pr_stores: Array<{ owner: string; repo: string; version: string }>;
	rate_limit: GitHubRateLimitSnapshot;
	stats: {
		repos_processed: number;
		repos_skipped: number;
		total_commits: number;
		total_prs: number;
		new_commits: number;
		new_prs: number;
		stopped_early: "quota_reserve" | "rate_limited" | null;
	};
};

const mergeCommits = (
	existing: GitHubRepoCommitsStore | null,
	incoming: GitHubRepoCommitsStore,
): { merged: GitHubRepoCommitsStore; newCount: number } => {
	const { merged: commits, newCount } = mergeByKey(existing?.commits, incoming.commits, (c) => c.sha);
	return {
		merged: {
			owner: incoming.owner,
			repo: incoming.repo,
			branches: [...new Set([...(existing?.branches ?? []), ...incoming.branches])],
			commits,
			total_commits: commits.length,
			fetched_at: incoming.fetched_at,
		},
		newCount,
	};
};

// prefer: "incoming" — a PR re-fetched this run (state/title/commits changed)
// must replace its stored copy, not lose to the stale one.
const mergePRs = (
	existing: GitHubRepoPRsStore | null,
	incoming: GitHubRepoPRsStore,
): { merged: GitHubRepoPRsStore; newCount: number } => {
	const { merged: pull_requests, newCount } = mergeByKey(
		existing?.pull_requests,
		incoming.pull_requests,
		(pr) => String(pr.number),
		{ prefer: "incoming" },
	);
	return {
		merged: {
			owner: incoming.owner,
			repo: incoming.repo,
			pull_requests,
			total_prs: pull_requests.length,
			fetched_at: incoming.fetched_at,
		},
		newCount,
	};
};

type GitHubProvider = {
	fetch(token: string, input?: GitHubFetchInput): Promise<Result<GitHubFetchResult, ProviderError>>;
};

type RepoStoreStats = { owner: string; repo: string; version: string; newCount: number; total: number };
const defaultRepoStats = (owner: string, repo: string): RepoStoreStats => ({
	owner,
	repo,
	version: "",
	newCount: 0,
	total: 0,
});

type PrevSyncState = { meta: GitHubMetaStore | null; sync_state: GitHubSyncState | null };

const loadPrevState = async (backend: Backend, accountId: string): Promise<PrevSyncState> => {
	const metaResult = store.github.meta(backend, accountId);
	if (!metaResult.ok) return { meta: null, sync_state: null };

	const latest = to_nullable(await metaResult.value.store.get_latest());
	const meta = latest?.data ?? null;
	return { meta, sync_state: meta?.sync_state ?? null };
};

// Repos fully fetched this run advance to the freshly-observed pushed_at;
// everything else (unchanged, over the per-run cap, quota-stopped, or partially
// failed) keeps its previous state so the next run picks it up.
const buildSyncState = (
	meta: GitHubMetaStore,
	completed: string[],
	prevState: GitHubSyncState | null,
): GitHubSyncState => {
	const now = new Date().toISOString();
	const completedSet = new Set(completed);
	const prevRepos: Partial<Record<string, GitHubRepoSyncState>> = prevState?.repos ?? {};

	const repos: GitHubSyncState["repos"] = {};
	for (const repo of meta.repositories) {
		const prev = prevRepos[repo.full_name];
		if (completedSet.has(repo.full_name)) {
			repos[repo.full_name] = { pushed_at: repo.pushed_at, synced_at: now };
		} else if (prev) {
			repos[repo.full_name] = prev;
		}
	}

	return { repos, updated_at: now };
};

const storeMeta = (backend: Backend, accountId: string, meta: GitHubMetaStore): Promise<string> =>
	genericStoreMeta(backend, accountId, store.github.meta, meta);

const storeCommits = async (
	backend: Backend,
	accountId: string,
	owner: string,
	repo: string,
	incoming: GitHubRepoCommitsStore,
): Promise<RepoStoreStats> => {
	const storeResult = store.github.commits(backend, accountId, owner, repo);
	if (!storeResult.ok) return defaultRepoStats(owner, repo);

	const s = storeResult.value.store;
	const existing = to_nullable(await s.get_latest())?.data ?? null;
	const { merged, newCount } = mergeCommits(existing, incoming);
	const putResult = await s.put(merged);

	return pipe(putResult)
		.map(({ version }: { version: string }) => ({ owner, repo, version, newCount, total: merged.total_commits }))
		.tap(({ newCount: n, total }: { newCount: number; total: number }) => {
			log.debug("Stored commits", { owner, repo, new: n, total });
		})
		.unwrap_or(defaultRepoStats(owner, repo));
};

const storePRs = async (
	backend: Backend,
	accountId: string,
	owner: string,
	repo: string,
	incoming: GitHubRepoPRsStore,
): Promise<RepoStoreStats> => {
	const storeResult = store.github.prs(backend, accountId, owner, repo);
	if (!storeResult.ok) return defaultRepoStats(owner, repo);

	const s = storeResult.value.store;
	const existing = to_nullable(await s.get_latest())?.data ?? null;
	const { merged, newCount } = mergePRs(existing, incoming);
	const putResult = await s.put(merged);

	return pipe(putResult)
		.map(({ version }: { version: string }) => ({ owner, repo, version, newCount, total: merged.total_prs }))
		.tap(({ newCount: n, total }: { newCount: number; total: number }) => {
			log.debug("Stored PRs", { owner, repo, new: n, total });
		})
		.unwrap_or(defaultRepoStats(owner, repo));
};

export async function processGitHubAccount(
	backend: Backend,
	accountId: string,
	token: string,
	provider: GitHubProvider,
): Promise<Result<GitHubProcessResult, ProcessError>> {
	log.info("Processing account", { account_id: accountId });

	const prevState = await loadPrevState(backend, accountId);
	const fetchInput: GitHubFetchInput = { sync_state: prevState.sync_state, previous_meta: prevState.meta };

	const fetchResult = await provider.fetch(token, fetchInput);
	if (!fetchResult.ok) {
		return err(formatFetchError("GitHub", fetchResult.error));
	}

	const { meta: freshMeta, repos, completed, skipped, rate_limit, stopped_early } = fetchResult.value;
	const meta: GitHubMetaStore = {
		...freshMeta,
		sync_state: buildSyncState(freshMeta, completed, prevState.sync_state),
	};
	const metaVersion = await storeMeta(backend, accountId, meta);

	const commitStores: Array<{ owner: string; repo: string; version: string }> = [];
	const prStores: Array<{ owner: string; repo: string; version: string }> = [];
	let totalCommits = 0;
	let totalPRs = 0;
	let newCommits = 0;
	let newPRs = 0;

	for (const [fullName, data] of repos) {
		const [owner, repo] = fullName.split("/");
		if (!owner || !repo) continue;

		const commitResult = await storeCommits(backend, accountId, owner, repo, data.commits);
		if (commitResult.version) {
			commitStores.push({ owner, repo, version: commitResult.version });
			totalCommits += commitResult.total;
			newCommits += commitResult.newCount;
		}

		const prResult = await storePRs(backend, accountId, owner, repo, data.prs);
		if (prResult.version) {
			prStores.push({ owner, repo, version: prResult.version });
			totalPRs += prResult.total;
			newPRs += prResult.newCount;
		}
	}

	log.info("Processing complete", {
		account_id: accountId,
		repos: repos.size,
		skipped: skipped.length,
		total_commits: totalCommits,
		new_commits: newCommits,
		total_prs: totalPRs,
		new_prs: newPRs,
		stopped_early,
	});

	return ok({
		account_id: accountId,
		meta_version: metaVersion,
		commit_stores: commitStores,
		pr_stores: prStores,
		rate_limit,
		stats: {
			repos_processed: repos.size,
			repos_skipped: skipped.length,
			total_commits: totalCommits,
			total_prs: totalPRs,
			new_commits: newCommits,
			new_prs: newPRs,
			stopped_early,
		},
	});
}
