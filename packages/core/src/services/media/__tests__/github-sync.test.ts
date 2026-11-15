import { Database } from "bun:sqlite";
import { createBunDatabase, migrateBunDatabase } from "@devpad/schema/database/bun";
import type { Database as MediaDatabase } from "@devpad/schema/database/types";
import { type GitHubSyncState, accounts, profiles, rateLimits } from "@devpad/schema/media";
import { create_memory_backend, err, type Backend } from "@f0rbit/corpus";
import { eq } from "drizzle-orm";
import { describe, expect, test } from "bun:test";
import { processGitHubAccount } from "../cron/processors/github";
import type { AppContext, GitHubProviderLike } from "../context";
import { type GitHubProviderConfig, GitHubProvider } from "../platforms/github";
import { loadGitHubData } from "../platforms/github/timeline";
import type { ProviderError, ProviderFactory } from "../platforms/types";
import { store } from "../storage";
import { processAccount } from "../sync";
import { secrets } from "../utils";

// ============================================================================
// In-memory GitHub REST fake (Provider pattern — counts every HTTP call)
// ============================================================================

type FakeCommit = {
	sha: string;
	message: string;
	author_name: string;
	author_email: string;
	author_date: string;
	committer_date: string;
};

type FakePR = {
	id: number;
	number: number;
	title: string;
	state: "open" | "closed";
	created_at: string;
	updated_at: string;
	closed_at: string | null;
	merged_at: string | null;
	merge_commit_sha: string | null;
	head_ref: string;
	base_ref: string;
	user_login: string;
};

type FakeRepo = {
	owner: string;
	name: string;
	is_private: boolean;
	fork: boolean;
	pushed_at: string | null;
	updated_at: string;
	default_branch: string;
	branches: string[];
	commits: FakeCommit[];
	pulls: FakePR[];
	pr_commits: Record<string, string[]>;
};

type FakeCall = { path: string; params: Record<string, string> };

type FakeGitHubOptions = {
	username: string;
	repos: FakeRepo[];
	rate_limit: { limit: number; start_remaining: number; reset_at: number; cost_per_call?: number };
	fail_on?: (call: FakeCall) => boolean;
	provider_config?: Partial<GitHubProviderConfig>;
};

const createFakeGitHub = (options: FakeGitHubOptions) => {
	const calls: FakeCall[] = [];
	let remaining = options.rate_limit.start_remaining;
	const cost = options.rate_limit.cost_per_call ?? 1;
	let failing = false;

	const respond = (data: unknown, status = 200, remaining_override?: number): Response => {
		const headers = new Headers({
			"content-type": "application/json",
			"x-ratelimit-limit": String(options.rate_limit.limit),
			"x-ratelimit-remaining": String(remaining_override ?? Math.max(0, remaining)),
			"x-ratelimit-reset": String(options.rate_limit.reset_at),
		});
		return new Response(JSON.stringify(data), { status, headers });
	};

	const fetchImpl = (async (input: string | URL | Request): Promise<Response> => {
		const url = new URL(typeof input === "string" ? input : input instanceof Request ? input.url : String(input));
		const path = url.pathname;
		const params = Object.fromEntries(url.searchParams);
		calls.push({ path, params });
		remaining -= cost;

		const fail = failing || (options.fail_on?.({ path, params }) ?? false);
		if (fail) return respond({ message: "API rate limit exceeded" }, 403, 0);

		const page = Number.parseInt(params.page ?? "1", 10);
		const per_page = Number.parseInt(params.per_page ?? "30", 10);

		if (path === "/user") return respond({ login: options.username });

		if (path === "/user/repos") {
			const sorted = options.repos.toSorted(
				(a, b) => new Date(b.pushed_at ?? 0).getTime() - new Date(a.pushed_at ?? 0).getTime(),
			);
			const slice = sorted.slice((page - 1) * per_page, page * per_page);
			return respond(
				slice.map((repo, index) => ({
					id: options.repos.indexOf(repo) + 1 + index * 1000,
					name: repo.name,
					full_name: `${repo.owner}/${repo.name}`,
					owner: { login: repo.owner },
					default_branch: repo.default_branch,
					private: repo.is_private,
					fork: repo.fork,
					pushed_at: repo.pushed_at,
					updated_at: repo.updated_at,
				})),
			);
		}

		const repo_match = path.match(/^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/);
		if (repo_match) {
			const owner = repo_match[1];
			const name = repo_match[2];
			const sub = repo_match[3];
			const repo = options.repos.find((r) => r.owner === owner && r.name === name);
			if (!repo) return respond({ message: "Not Found" }, 404);
			const full_name = `${owner}/${name}`;

			if (sub === "/branches") return respond(repo.branches.map((branch_name) => ({ name: branch_name })));

			if (sub === "/commits") {
				const since = params.since;
				const matching = since ? repo.commits.filter((c) => c.committer_date >= since) : repo.commits;
				const slice = matching.slice((page - 1) * per_page, page * per_page);
				return respond(
					slice.map((c) => ({
						sha: c.sha,
						commit: {
							message: c.message,
							author: { name: c.author_name, email: c.author_email, date: c.author_date },
							committer: { name: c.author_name, email: c.author_email, date: c.committer_date },
						},
						html_url: `https://github.com/${full_name}/commit/${c.sha}`,
					})),
				);
			}

			if (sub === "/pulls") {
				const sorted = repo.pulls.toSorted(
					(a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
				);
				const slice = sorted.slice((page - 1) * per_page, page * per_page);
				return respond(
					slice.map((p) => ({
						id: p.id,
						number: p.number,
						title: p.title,
						body: null,
						state: p.state,
						html_url: `https://github.com/${full_name}/pull/${String(p.number)}`,
						created_at: p.created_at,
						updated_at: p.updated_at,
						closed_at: p.closed_at,
						merged_at: p.merged_at,
						head: { ref: p.head_ref },
						base: { ref: p.base_ref },
						merge_commit_sha: p.merge_commit_sha,
						user: { login: p.user_login, avatar_url: `https://avatars.githubusercontent.com/u/${String(p.id)}` },
					})),
				);
			}

			const pr_match = sub?.match(/^\/pulls\/(\d+)\/commits$/);
			if (pr_match) {
				return respond((repo.pr_commits[String(pr_match[1])] ?? []).map((sha) => ({ sha })));
			}
		}

		return respond({ message: "Not Found" }, 404);
	}) as typeof fetch;

	const provider = new GitHubProvider(options.provider_config ?? {}, fetchImpl);

	return {
		calls,
		provider,
		startFailing: () => {
			failing = true;
		},
	};
};

const make_commit = (sha: string, committer_date: string, message = `commit ${sha.slice(0, 6)}`): FakeCommit => ({
	sha,
	message,
	author_name: "Test User",
	author_email: "test@example.com",
	author_date: committer_date,
	committer_date,
});

const make_pr = (
	number: number,
	updated_at: string,
	state: "open" | "closed" = "open",
	merged_at: string | null = null,
): FakePR => ({
	id: 900000 + number,
	number,
	title: `PR ${String(number)}`,
	state,
	created_at: "2025-01-01T00:00:00Z",
	updated_at,
	closed_at: state === "closed" ? updated_at : null,
	merged_at,
	merge_commit_sha: merged_at ? `merge${String(number)}` : null,
	head_ref: "feature",
	base_ref: "main",
	user_login: "testuser",
});

const repoA = (): FakeRepo => ({
	owner: "testuser",
	name: "repo-a",
	is_private: false,
	fork: false,
	pushed_at: "2026-01-01T00:00:00Z",
	updated_at: "2026-01-01T00:00:00Z",
	default_branch: "main",
	branches: ["main"],
	commits: [
		make_commit("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "2025-12-01T00:00:00Z"),
		make_commit("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "2025-12-15T00:00:00Z"),
	],
	pulls: [make_pr(1, "2025-12-20T00:00:00Z"), make_pr(2, "2025-12-10T00:00:00Z")],
	pr_commits: {
		"1": ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
		"2": ["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
	},
});

const repoB = (): FakeRepo => ({
	owner: "testuser",
	name: "repo-b",
	is_private: false,
	fork: false,
	pushed_at: "2025-06-01T00:00:00Z",
	updated_at: "2025-06-01T00:00:00Z",
	default_branch: "main",
	branches: ["main"],
	commits: [make_commit("cccccccccccccccccccccccccccccccccccccccc", "2025-05-01T00:00:00Z")],
	pulls: [],
	pr_commits: {},
});

const reset_at_epoch = (): number => Math.floor(Date.now() / 1000) + 3600;

// ============================================================================
// Test DB + AppContext helper
// ============================================================================

const TEST_KEY = "test-encryption-key";

const createTestDb = (): MediaDatabase => {
	const sqlite = new Database(":memory:");
	migrateBunDatabase(sqlite);
	return createBunDatabase(sqlite);
};

const providerFactory: ProviderFactory = {
	create: async () => err<ProviderError>({ kind: "network_error", cause: new Error("unused") }),
};

const makeCtx = (db: MediaDatabase, backend: Backend, provider: GitHubProviderLike): AppContext => ({
	db,
	backend,
	providerFactory,
	encryptionKey: TEST_KEY,
	gitHubProvider: provider,
});

const seedAccount = async (
	db: MediaDatabase,
	account_id: string,
	last_fetched_at: string | null = null,
): Promise<void> => {
	const now = new Date().toISOString();
	await db.insert(profiles).values({
		id: "prof_test_1",
		user_id: "user_test_1",
		slug: "test",
		name: "Test",
		created_at: now,
		updated_at: now,
	});
	const encrypted = await secrets.encrypt("test-token", TEST_KEY);
	if (!encrypted.ok) throw new Error("test token encryption failed");
	await db.insert(accounts).values({
		id: account_id,
		profile_id: "prof_test_1",
		platform: "github",
		platform_user_id: "gh_test_1",
		platform_username: "testuser",
		access_token_encrypted: encrypted.value,
		is_active: true,
		last_fetched_at,
		created_at: now,
		updated_at: now,
	});
};

const loadAccount = async (db: MediaDatabase, account_id: string) => {
	const row = await db.select().from(accounts).where(eq(accounts.id, account_id)).get();
	if (!row) throw new Error("test account not seeded");
	return { ...row, user_id: "user_test_1" };
};

const getRateLimitRow = async (db: MediaDatabase, account_id: string) =>
	db.select().from(rateLimits).where(eq(rateLimits.account_id, account_id)).get();

const storedCommits = async (backend: Backend, account_id: string, owner: string, repo: string) => {
	const result = store.github.commits(backend, account_id, owner, repo);
	if (!result.ok) return null;
	const latest = await result.value.store.get_latest();
	return latest.ok ? latest.value.data : null;
};

const storedPRs = async (backend: Backend, account_id: string, owner: string, repo: string) => {
	const result = store.github.prs(backend, account_id, owner, repo);
	if (!result.ok) return null;
	const latest = await result.value.store.get_latest();
	return latest.ok ? latest.value.data : null;
};

const latestSyncState = async (backend: Backend, account_id: string): Promise<GitHubSyncState | null> => {
	const result = store.github.meta(backend, account_id);
	if (!result.ok) return null;
	const latest = await result.value.store.get_latest();
	return latest.ok ? (latest.value.data.sync_state ?? null) : null;
};

const callsTo = (calls: FakeCall[], substring: string): FakeCall[] => calls.filter((c) => c.path.includes(substring));

// ============================================================================
// Tests
// ============================================================================

describe("github sync quota (#163)", () => {
	test("no-change run: zero per-repo calls, previously-synced data preserved", async () => {
		const backend = create_memory_backend();
		const fake = createFakeGitHub({
			username: "testuser",
			repos: [repoA(), repoB()],
			rate_limit: { limit: 5000, start_remaining: 4990, reset_at: reset_at_epoch() },
		});

		const first = await processGitHubAccount(backend, "acc1", "token", fake.provider);
		expect(first.ok).toBe(true);
		expect(callsTo(fake.calls, "/repos/").length).toBeGreaterThan(0);

		const commitsAfterFirst = await storedCommits(backend, "acc1", "testuser", "repo-a");
		expect(commitsAfterFirst?.total_commits).toBe(2);

		fake.calls.length = 0;
		await Bun.sleep(10);
		const second = await processGitHubAccount(backend, "acc1", "token", fake.provider);
		expect(second.ok).toBe(true);

		expect(fake.calls.map((c) => c.path).toSorted()).toEqual(["/user", "/user/repos"]);

		if (second.ok) {
			expect(second.value.stats.repos_processed).toBe(0);
			expect(second.value.stats.repos_skipped).toBe(2);
			expect(second.value.stats.new_commits).toBe(0);
			expect(second.value.stats.new_prs).toBe(0);
		}

		const commitsAfterSecond = await storedCommits(backend, "acc1", "testuser", "repo-a");
		expect(commitsAfterSecond?.total_commits).toBe(2);
		expect(commitsAfterSecond?.commits.map((c) => c.sha)).toContain("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

		const timeline = await loadGitHubData(backend, "acc1");
		expect(timeline.commits.length).toBe(3);
		expect(new Set(timeline.commits.map((c) => c.repo_name))).toEqual(new Set(["testuser/repo-a", "testuser/repo-b"]));

		const state = await latestSyncState(backend, "acc1");
		expect(state?.repos["testuser/repo-a"]?.synced_at).toBeTruthy();
		expect(state?.repos["testuser/repo-b"]?.synced_at).toBeTruthy();
	});

	test("one-repo-changed run: calls only for that repo, since passed, PRs early-stopped, merge dedupes", async () => {
		const backend = create_memory_backend();
		const repo_a = repoA();
		const fake = createFakeGitHub({
			username: "testuser",
			repos: [repo_a, repoB()],
			rate_limit: { limit: 5000, start_remaining: 4990, reset_at: reset_at_epoch() },
		});

		const first = await processGitHubAccount(backend, "acc1", "token", fake.provider);
		expect(first.ok).toBe(true);
		if (!first.ok) return;

		const state = await latestSyncState(backend, "acc1");
		const synced_at = state?.repos["testuser/repo-a"]?.synced_at;
		expect(synced_at).toBeTruthy();

		// Mutate repo A between runs: new push (new commit), PR 1 closed + updated,
		// brand-new PR 4. PR 2 stays untouched (older than the last sync).
		repo_a.pushed_at = "2026-02-01T00:00:00Z";
		const later = new Date(Date.now() + 60_000).toISOString();
		repo_a.commits.push(make_commit("dddddddddddddddddddddddddddddddddddddddd", later));
		const updated_pr1 = { ...repo_a.pulls[0], state: "closed" as const, updated_at: later };
		repo_a.pulls = [updated_pr1, make_pr(4, later), repo_a.pulls[1]];
		repo_a.pr_commits["4"] = ["dddddddddddddddddddddddddddddddddddddddd"];

		fake.calls.length = 0;
		await Bun.sleep(10);
		const second = await processGitHubAccount(backend, "acc1", "token", fake.provider);
		expect(second.ok).toBe(true);

		const calledRepos = new Set(
			fake.calls.flatMap((c) => c.path.match(/\/repos\/([^/]+)\/([^/]+)/) ?? []).filter((p) => p.startsWith("repo-")),
		);
		expect(calledRepos.has("repo-a")).toBe(true);
		expect(calledRepos.has("repo-b")).toBe(false);

		const commits_calls = callsTo(fake.calls, "/repos/testuser/repo-a/commits");
		expect(commits_calls.length).toBe(1);
		expect(commits_calls[0]?.params.since).toBe(synced_at);

		const pr_commit_paths = callsTo(fake.calls, "/pulls/").map((c) => c.path);
		expect(pr_commit_paths).toContain("/repos/testuser/repo-a/pulls/4/commits");
		expect(pr_commit_paths).toContain("/repos/testuser/repo-a/pulls/1/commits");
		expect(pr_commit_paths).not.toContain("/repos/testuser/repo-a/pulls/2/commits");

		const commits = await storedCommits(backend, "acc1", "testuser", "repo-a");
		expect(commits?.total_commits).toBe(3);
		const shas = commits?.commits.map((c) => c.sha) ?? [];
		expect(new Set(shas).size).toBe(3);
		expect(shas).toContain("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
		expect(shas).toContain("dddddddddddddddddddddddddddddddddddddddd");

		const prs = await storedPRs(backend, "acc1", "testuser", "repo-a");
		expect(prs?.total_prs).toBe(3);
		const pr_by_number = new Map((prs?.pull_requests ?? []).map((p) => [p.number, p]));
		expect(pr_by_number.get(1)?.state).toBe("closed");
		expect(pr_by_number.get(2)?.state).toBe("open");
		expect(pr_by_number.get(4)?.commit_shas).toEqual(["dddddddddddddddddddddddddddddddddddddddd"]);

		const timeline = await loadGitHubData(backend, "acc1");
		expect(timeline.commits.length).toBe(4);
		expect(timeline.prs.length).toBe(3);

		const state2 = await latestSyncState(backend, "acc1");
		expect(state2?.repos["testuser/repo-a"]?.pushed_at).toBe("2026-02-01T00:00:00Z");
		expect(state2?.repos["testuser/repo-b"]?.synced_at).toBeTruthy();
	});

	test("quota reserve: mid-run stop saves partial progress, next run before reset makes zero calls", async () => {
		const db = createTestDb();
		const backend = create_memory_backend();
		await seedAccount(db, "acc1");

		// cost 250/call, sequential fetch (concurrency 1) for deterministic call
		// ordering: /user(1650) → /user/repos(1400) → branches(1150) → commits(900)
		// → reserve hit → pulls skipped, repo-b never started.
		const fake = createFakeGitHub({
			username: "testuser",
			repos: [repoA(), repoB()],
			rate_limit: { limit: 5000, start_remaining: 1900, reset_at: reset_at_epoch(), cost_per_call: 250 },
			provider_config: { concurrency: 1 },
		});
		const ctx = makeCtx(db, backend, fake.provider);

		const snapshot1 = await processAccount(ctx, await loadAccount(db, "acc1"));
		expect(snapshot1).not.toBeNull();

		const row1 = await getRateLimitRow(db, "acc1");
		expect(row1?.remaining).toBe(900);
		expect(row1?.limit_total).toBe(5000);
		expect(row1?.reset_at).toBeTruthy();
		expect(row1?.consecutive_failures).toBe(0);

		// Partial progress saved: repo-a commits merged into its store.
		const commits = await storedCommits(backend, "acc1", "testuser", "repo-a");
		expect(commits?.total_commits).toBeGreaterThan(0);

		// State NOT advanced for the interrupted repo — next run must refetch it.
		const state = await latestSyncState(backend, "acc1");
		expect(state?.repos["testuser/repo-a"]).toBeUndefined();

		const calls_before = fake.calls.length;
		const snapshot2 = await processAccount(ctx, await loadAccount(db, "acc1"));
		expect(snapshot2).toBeNull();
		expect(fake.calls.length).toBe(calls_before);
	});

	test("403 rate-limit mid-run: stops, records reset, circuit breaker not tripped", async () => {
		const db = createTestDb();
		const backend = create_memory_backend();
		await seedAccount(db, "acc1");

		const fake = createFakeGitHub({
			username: "testuser",
			repos: [repoA(), repoB()],
			rate_limit: { limit: 5000, start_remaining: 4990, reset_at: reset_at_epoch() },
			fail_on: (call) => call.path.endsWith("/pulls"),
			provider_config: { concurrency: 1 },
		});
		const ctx = makeCtx(db, backend, fake.provider);

		const snapshot = await processAccount(ctx, await loadAccount(db, "acc1"));
		expect(snapshot).not.toBeNull();

		const row = await getRateLimitRow(db, "acc1");
		expect(row?.remaining).toBe(0);
		expect(row?.reset_at).toBeTruthy();
		expect(row?.consecutive_failures).toBe(0);
		expect(row?.circuit_open_until).toBeNull();

		const commits = await storedCommits(backend, "acc1", "testuser", "repo-a");
		expect(commits?.total_commits).toBe(2);

		const calls_before = fake.calls.length;
		const snapshot2 = await processAccount(ctx, await loadAccount(db, "acc1"));
		expect(snapshot2).toBeNull();
		expect(fake.calls.length).toBe(calls_before);
	});

	test("403 on first request: fetch fails with rate_limited, reset recorded, not a generic failure", async () => {
		const db = createTestDb();
		const backend = create_memory_backend();
		await seedAccount(db, "acc1");

		const fake = createFakeGitHub({
			username: "testuser",
			repos: [repoA(), repoB()],
			rate_limit: { limit: 5000, start_remaining: 0, reset_at: reset_at_epoch() },
		});
		fake.startFailing();
		const ctx = makeCtx(db, backend, fake.provider);

		const snapshot = await processAccount(ctx, await loadAccount(db, "acc1"));
		expect(snapshot).toBeNull();

		const row = await getRateLimitRow(db, "acc1");
		expect(row?.remaining).toBe(0);
		expect(row?.reset_at).toBeTruthy();
		expect(row?.consecutive_failures).toBe(0);
		expect(row?.circuit_open_until).toBeNull();
	});

	test("30-minute interval: second run within 30 minutes makes zero GitHub calls", async () => {
		const db = createTestDb();
		const backend = create_memory_backend();
		await seedAccount(db, "acc1");

		const fake = createFakeGitHub({
			username: "testuser",
			repos: [repoA(), repoB()],
			rate_limit: { limit: 5000, start_remaining: 4990, reset_at: reset_at_epoch() },
		});
		const ctx = makeCtx(db, backend, fake.provider);

		const first = await processAccount(ctx, await loadAccount(db, "acc1"));
		expect(first).not.toBeNull();
		const calls_after_first = fake.calls.length;
		expect(calls_after_first).toBeGreaterThan(0);

		const second = await processAccount(ctx, await loadAccount(db, "acc1"));
		expect(second).toBeNull();
		expect(fake.calls.length).toBe(calls_after_first);

		await db
			.update(accounts)
			.set({ last_fetched_at: new Date(Date.now() - 31 * 60 * 1000).toISOString() })
			.where(eq(accounts.id, "acc1"));
		const third = await processAccount(ctx, await loadAccount(db, "acc1"));
		expect(third).not.toBeNull();
		expect(fake.calls.length).toBeGreaterThan(calls_after_first);
	});
});
