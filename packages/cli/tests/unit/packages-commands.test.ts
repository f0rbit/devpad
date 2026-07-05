/**
 * Unit tests for the `pipelines packages …` CLI command actions added in
 * Phase 14. We don't exercise the Commander wiring — we drive the
 * exported `action_packages_*` functions with a hand-rolled fake
 * ApiClient so the tests stay deterministic and offline.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	action_packages_create,
	action_packages_delete,
	action_packages_get,
	action_packages_list,
	action_packages_update,
} from "../../src/commands/pipelines";

type ApiOk<T> = { ok: true; value: T };
type ApiErr = { ok: false; error: { message: string; status?: number; code?: string } };
type ApiResult<T> = ApiOk<T> | ApiErr;

const ok = <T>(value: T): ApiOk<T> => ({ ok: true, value });
const err = (message: string, status = 500, code = "unknown"): ApiErr => ({
	ok: false,
	error: { message, status, code },
});

type Recorded = { kind: string; args: unknown[] };

type FakeClient = {
	calls: Recorded[];
	pipelines: {
		packages: {
			list: (filter?: { project_id?: string }) => Promise<ApiResult<unknown[]>>;
			get: (id: string) => Promise<ApiResult<unknown>>;
			create: (input: unknown) => Promise<ApiResult<unknown>>;
			update: (id: string, patch: unknown) => Promise<ApiResult<unknown>>;
			delete: (id: string) => Promise<ApiResult<{ deleted: true }>>;
		};
	};
	projects: { list: () => Promise<ApiResult<Array<{ id: string; project_id: string }>>> };
	auth: { session: () => Promise<ApiResult<{ authenticated: true; user: { id: string } | null; session: null }>> };
};

const build_fake_client = (
	overrides: Partial<FakeClient["pipelines"]["packages"]> = {},
	opts: {
		projects?: Array<{ id: string; project_id: string }>;
		session_user_id?: string | null;
		session_ok?: boolean;
	} = {},
): FakeClient => {
	const calls: Recorded[] = [];
	const projects = opts.projects ?? [];
	return {
		calls,
		pipelines: {
			packages: {
				list: async (filter) => {
					calls.push({ kind: "list", args: [filter] });
					return (
						overrides.list
							? overrides.list(filter)
							: ok([{ id: "pipeline-package_a", name: "a", project_id: null, repo_url: null }])
					) as Promise<ApiResult<unknown[]>>;
				},
				get: async (id) => {
					calls.push({ kind: "get", args: [id] });
					return (overrides.get ? overrides.get(id) : ok({ id, name: "a", project_id: null })) as Promise<
						ApiResult<unknown>
					>;
				},
				create: async (input) => {
					calls.push({ kind: "create", args: [input] });
					return (
						overrides.create
							? overrides.create(input)
							: ok({ ...(input as Record<string, unknown>), id: (input as { id: string }).id })
					) as Promise<ApiResult<unknown>>;
				},
				update: async (id, patch) => {
					calls.push({ kind: "update", args: [id, patch] });
					return (
						overrides.update ? overrides.update(id, patch) : ok({ id, ...(patch as Record<string, unknown>) })
					) as Promise<ApiResult<unknown>>;
				},
				delete: async (id) => {
					calls.push({ kind: "delete", args: [id] });
					return (overrides.delete ? overrides.delete(id) : ok({ deleted: true })) as Promise<
						ApiResult<{ deleted: true }>
					>;
				},
			},
		},
		projects: {
			list: async () => ok(projects),
		},
		auth: {
			session: async () => {
				if (opts.session_ok === false) return err("session unavailable", 500);
				return ok({
					authenticated: true,
					user: opts.session_user_id === null ? null : { id: opts.session_user_id ?? "user_session" },
					session: null,
				});
			},
		},
	};
};

/**
 * Helpers to suppress chatty `console.log` output during tests but still
 * capture the messages on the rare assertion that needs them.
 */
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

describe("action_packages_list", () => {
	test("calls client.pipelines.packages.list with undefined filter when no --project", async () => {
		const client = build_fake_client();
		await action_packages_list(() => client as never)({});
		const list_calls = client.calls.filter((c) => c.kind === "list");
		expect(list_calls.length).toBe(1);
		expect(list_calls[0].args[0]).toBeUndefined();
	});

	test("resolves --project slug via projects.list and forwards project_id", async () => {
		const client = build_fake_client({}, { projects: [{ id: "internal_id_alpha", project_id: "alpha" }] });
		await action_packages_list(() => client as never)({ project: "alpha" });
		const list_calls = client.calls.filter((c) => c.kind === "list");
		expect(list_calls.length).toBe(1);
		expect(list_calls[0].args[0]).toEqual({ project_id: "internal_id_alpha" });
	});
});

describe("action_packages_get", () => {
	test("calls client.pipelines.packages.get with the supplied id", async () => {
		const client = build_fake_client();
		await action_packages_get(() => client as never)("pipeline-package_x");
		const get_calls = client.calls.filter((c) => c.kind === "get");
		expect(get_calls.length).toBe(1);
		expect(get_calls[0].args[0]).toBe("pipeline-package_x");
	});
});

describe("action_packages_create", () => {
	test("uses positional name; resolves owner_id from session when omitted", async () => {
		const client = build_fake_client({}, { session_user_id: "user_session" });
		await action_packages_create(() => client as never)("forbit-astro", {});
		const create_calls = client.calls.filter((c) => c.kind === "create");
		expect(create_calls.length).toBe(1);
		const input = create_calls[0].args[0] as { id: string; name: string; owner_id: string; project_id?: string };
		expect(input.id).toBe("forbit-astro");
		expect(input.name).toBe("forbit-astro");
		expect(input.owner_id).toBe("user_session");
		expect(input.project_id).toBeUndefined();
	});

	test("--project slug is resolved to project_id", async () => {
		const client = build_fake_client(
			{},
			{ session_user_id: "user_session", projects: [{ id: "internal_a", project_id: "forbit-dev" }] },
		);
		await action_packages_create(() => client as never)("forbit-astro", {
			project: "forbit-dev",
			repoUrl: "https://github.com/f0rbit/forbit-astro",
		});
		const create_calls = client.calls.filter((c) => c.kind === "create");
		const input = create_calls[0].args[0] as { project_id: string | null | undefined; repo_url?: string };
		expect(input.project_id).toBe("internal_a");
		expect(input.repo_url).toBe("https://github.com/f0rbit/forbit-astro");
	});

	test("--owner-id overrides session fallback", async () => {
		const client = build_fake_client({}, { session_user_id: "user_wrong" });
		await action_packages_create(() => client as never)("x", { ownerId: "user_override" });
		const create_calls = client.calls.filter((c) => c.kind === "create");
		const input = create_calls[0].args[0] as { owner_id: string };
		expect(input.owner_id).toBe("user_override");
	});
});

describe("action_packages_update", () => {
	test("forwards --repo-url to update patch", async () => {
		const client = build_fake_client();
		await action_packages_update(() => client as never)("pipeline-package_x", { repoUrl: "https://new.example/x" });
		const update_calls = client.calls.filter((c) => c.kind === "update");
		expect(update_calls.length).toBe(1);
		expect(update_calls[0].args[0]).toBe("pipeline-package_x");
		expect(update_calls[0].args[1]).toEqual({ repo_url: "https://new.example/x" });
	});

	test("parses --script-name-overrides JSON", async () => {
		const client = build_fake_client();
		await action_packages_update(() => client as never)("pipeline-package_x", {
			scriptNameOverrides: '{"staging":"x-stg"}',
		});
		const update_calls = client.calls.filter((c) => c.kind === "update");
		expect(update_calls[0].args[1]).toEqual({ script_name_overrides: { staging: "x-stg" } });
	});
});

describe("action_packages_delete", () => {
	test("calls client.pipelines.packages.delete with the supplied id", async () => {
		const client = build_fake_client();
		await action_packages_delete(() => client as never)("pipeline-package_x", {});
		const delete_calls = client.calls.filter((c) => c.kind === "delete");
		expect(delete_calls.length).toBe(1);
		expect(delete_calls[0].args[0]).toBe("pipeline-package_x");
	});
});
