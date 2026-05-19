/**
 * Integration tests for the `pipelines oidc-trust …` CLI command actions
 * added in Phase 15.D. Drives the exported `action_oidc_trust_*`
 * functions against a hand-rolled fake ApiClient — same pattern used by
 * `tests/unit/packages-commands.test.ts`. No HTTP, no D1, deterministic
 * + offline.
 *
 * The `pipelines workflow migrate` command is also covered here since
 * it shares the action-factory shape; it touches a tmpdir under
 * /tmp/devpad-cli-tests/.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { action_oidc_trust_add, action_oidc_trust_list, action_oidc_trust_remove, action_oidc_trust_show, action_workflow_migrate } from "../../src/commands/pipelines";

type ApiOk<T> = { ok: true; value: T };
type ApiErr = { ok: false; error: { message: string; status?: number; code?: string } };
type ApiResult<T> = ApiOk<T> | ApiErr;

const ok_result = <T>(value: T): ApiOk<T> => ({ ok: true, value });

type Recorded = { kind: string; args: unknown[] };

type Policy = {
	id: string;
	owner_id: string;
	github_owner: string;
	repo_pattern: string;
	expected_audience: string;
	allowed_actions: string[];
	allowed_refs: string[] | null;
	allowed_environments: string[] | null;
	session_ttl_seconds: number;
	last_used_at: string | null;
	provider: "github";
};

const make_policy = (overrides: Partial<Policy> = {}): Policy => ({
	id: "pipeline-oidc-trust_default",
	owner_id: "user_test",
	github_owner: "f0rbit",
	repo_pattern: "*",
	expected_audience: "https://devpad-pipelines.dev-818.workers.dev",
	allowed_actions: ["artifacts:upload", "runs:start"],
	allowed_refs: [],
	allowed_environments: [],
	session_ttl_seconds: 900,
	last_used_at: null,
	provider: "github",
	...overrides,
});

type FakeClient = {
	calls: Recorded[];
	pipelines: {
		oidc_trust: {
			list: (input: { owner_id: string }) => Promise<ApiResult<Policy[]>>;
			get: (id: string, input: { owner_id: string }) => Promise<ApiResult<Policy>>;
			create: (input: Record<string, unknown>) => Promise<ApiResult<Policy>>;
			delete: (id: string, input: { owner_id: string }) => Promise<ApiResult<{ deleted: true }>>;
		};
	};
	auth: { session: () => Promise<ApiResult<{ authenticated: true; user: { id: string } | null; session: null }>> };
};

const build_fake_client = (opts: { session_user_id?: string | null; policies?: Policy[]; created?: Policy } = {}): FakeClient => {
	const calls: Recorded[] = [];
	return {
		calls,
		pipelines: {
			oidc_trust: {
				list: async input => {
					calls.push({ kind: "list", args: [input] });
					return ok_result(opts.policies ?? []);
				},
				get: async (id, input) => {
					calls.push({ kind: "get", args: [id, input] });
					return ok_result(opts.policies?.find(p => p.id === id) ?? make_policy({ id }));
				},
				create: async input => {
					calls.push({ kind: "create", args: [input] });
					return ok_result(opts.created ?? make_policy({ ...(input as Partial<Policy>) }));
				},
				delete: async (id, input) => {
					calls.push({ kind: "delete", args: [id, input] });
					return ok_result({ deleted: true as const });
				},
			},
		},
		auth: {
			session: async () => ok_result({ authenticated: true as const, user: opts.session_user_id === null ? null : { id: opts.session_user_id ?? "user_session" }, session: null }),
		},
	};
};

let log_buffer: string[];
let error_buffer: string[];
let orig_log: typeof console.log;
let orig_error: typeof console.error;

beforeEach(() => {
	log_buffer = [];
	error_buffer = [];
	orig_log = console.log;
	orig_error = console.error;
	console.log = ((...args: unknown[]) => log_buffer.push(args.map(String).join(" "))) as typeof console.log;
	console.error = ((...args: unknown[]) => error_buffer.push(args.map(String).join(" "))) as typeof console.error;
});

afterEach(() => {
	console.log = orig_log;
	console.error = orig_error;
});

describe("action_oidc_trust_list", () => {
	test("resolves owner_id from session when --owner-id absent", async () => {
		const client = build_fake_client({ session_user_id: "user_session" });
		await action_oidc_trust_list(() => client as never)({});
		const list_calls = client.calls.filter(c => c.kind === "list");
		expect(list_calls.length).toBe(1);
		expect(list_calls[0].args[0]).toEqual({ owner_id: "user_session" });
	});

	test("prefers --owner-id over session", async () => {
		const client = build_fake_client({ session_user_id: "user_session" });
		await action_oidc_trust_list(() => client as never)({ ownerId: "user_override" });
		const list_calls = client.calls.filter(c => c.kind === "list");
		expect(list_calls[0].args[0]).toEqual({ owner_id: "user_override" });
	});

	test("renders an empty-state hint when no policies", async () => {
		const client = build_fake_client({ session_user_id: "user_session", policies: [] });
		await action_oidc_trust_list(() => client as never)({});
		const joined = log_buffer.join("\n");
		expect(joined).toContain("oidc-trust add");
	});

	test("renders policy fields for each row", async () => {
		const client = build_fake_client({
			session_user_id: "user_session",
			policies: [make_policy({ id: "pipeline-oidc-trust_a", github_owner: "f0rbit", repo_pattern: "forbit-*", allowed_refs: ["refs/heads/main"] })],
		});
		await action_oidc_trust_list(() => client as never)({});
		const joined = log_buffer.join("\n");
		expect(joined).toContain("pipeline-oidc-trust_a");
		expect(joined).toContain("f0rbit/forbit-*");
		expect(joined).toContain("refs/heads/main");
	});
});

describe("action_oidc_trust_show", () => {
	test("calls oidc_trust.get with the supplied id", async () => {
		const client = build_fake_client({ session_user_id: "user_session" });
		await action_oidc_trust_show(() => client as never)("pipeline-oidc-trust_x", {});
		const get_calls = client.calls.filter(c => c.kind === "get");
		expect(get_calls.length).toBe(1);
		expect(get_calls[0].args[0]).toBe("pipeline-oidc-trust_x");
	});
});

describe("action_oidc_trust_add", () => {
	test("flag-only path supplies all required values without prompting", async () => {
		const client = build_fake_client({ session_user_id: "user_session" });
		await action_oidc_trust_add(() => client as never)({
			owner: "f0rbit",
			aud: "https://devpad-pipelines.dev-818.workers.dev",
			repoPattern: "*",
			actions: "artifacts:upload,runs:start",
			ttl: "900",
		});
		const create_calls = client.calls.filter(c => c.kind === "create");
		expect(create_calls.length).toBe(1);
		const input = create_calls[0].args[0] as Record<string, unknown>;
		expect(input.owner_id).toBe("user_session");
		expect(input.github_owner).toBe("f0rbit");
		expect(input.expected_audience).toBe("https://devpad-pipelines.dev-818.workers.dev");
		expect(input.repo_pattern).toBe("*");
		expect(input.allowed_actions).toEqual(["artifacts:upload", "runs:start"]);
		expect(input.session_ttl_seconds).toBe(900);
	});

	test("--refs and --environments parsed as CSVs", async () => {
		const client = build_fake_client({ session_user_id: "user_session" });
		await action_oidc_trust_add(() => client as never)({
			owner: "f0rbit",
			aud: "https://aud.example",
			refs: "refs/heads/main, refs/heads/release/*",
			environments: "production, staging",
		});
		const create_calls = client.calls.filter(c => c.kind === "create");
		const input = create_calls[0].args[0] as Record<string, unknown>;
		expect(input.allowed_refs).toEqual(["refs/heads/main", "refs/heads/release/*"]);
		expect(input.allowed_environments).toEqual(["production", "staging"]);
	});
});

describe("action_oidc_trust_remove", () => {
	test("calls oidc_trust.delete when --yes supplied (no confirm)", async () => {
		const client = build_fake_client({ session_user_id: "user_session" });
		await action_oidc_trust_remove(() => client as never)("pipeline-oidc-trust_x", { yes: true });
		const delete_calls = client.calls.filter(c => c.kind === "delete");
		expect(delete_calls.length).toBe(1);
		expect(delete_calls[0].args[0]).toBe("pipeline-oidc-trust_x");
		expect(delete_calls[0].args[1]).toEqual({ owner_id: "user_session" });
	});
});

describe("action_workflow_migrate", () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(path.join(tmpdir(), "devpad-cli-workflow-"));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	test("dry-run reports change without writing the file", async () => {
		const client = build_fake_client();
		await action_workflow_migrate(() => client as never)("my-pkg", { cwd: tmp, dryRun: true });

		const joined = log_buffer.join("\n");
		expect(joined).toContain("would update");
		// File should NOT have been written.
		expect(() => readFileSync(path.join(tmp, ".github/workflows/deploy.yml"), "utf8")).toThrow();
	});

	test("non-dry-run writes the rendered workflow into <cwd>/.github/workflows/deploy.yml", async () => {
		const client = build_fake_client();
		await action_workflow_migrate(() => client as never)("my-pkg", { cwd: tmp });

		const written = readFileSync(path.join(tmp, ".github/workflows/deploy.yml"), "utf8");
		expect(written.length).toBeGreaterThan(0);
		// The Phase 15 template is expected to mention the orchestrator URL
		// or the OIDC exchange route in some shape — but to keep this test
		// stable across the parallel 15.C template work, we only assert
		// the file was created and isn't blank.
	});

	test("invalid --rollout returns an error to stderr", async () => {
		const client = build_fake_client();
		// `fail_with` calls `process.exit(1)`. Stub it out for this test.
		const orig_exit = process.exit;
		const exit_box: { code: number | null } = { code: null };
		process.exit = ((code?: number) => {
			exit_box.code = code ?? 0;
			throw new Error("__exit__");
		}) as typeof process.exit;
		try {
			await action_workflow_migrate(() => client as never)("my-pkg", { cwd: tmp, rollout: "bogus" }).catch(e => {
				if (e instanceof Error && e.message === "__exit__") return;
				throw e;
			});
		} finally {
			process.exit = orig_exit;
		}
		expect(exit_box.code).toBe(1);
	});
});
