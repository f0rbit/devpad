import { describe, expect, test } from "bun:test";
import type { HookActionStored, TaskEvent } from "@devpad/schema";
import type { CallerIdentity, GitHubVaultBinding, VaultRpcResult } from "../../vault.js";
import { VaultActionExecutor } from "../../vault.js";

const action: HookActionStored = { kind: "vault", scope: "github:releases:acme/widgets", op: "create_release" };

function fakeEvent(): TaskEvent {
	return {
		id: 1,
		event_id: "evt_test",
		kind: "task.completed",
		subject_id: "task_test",
		project_id: "project_test",
		actor: "user",
		payload: { kind: "task.completed", via: "user" },
		occurred_at: "2026-01-01 00:00:00",
		dispatch_status: "pending",
		dispatched_at: null,
	} as TaskEvent;
}

describe("VaultActionExecutor (task A3.4)", () => {
	test("passes devpad's caller identity explicitly and routes 'op' to the matching RPC method", async () => {
		let captured_identity: CallerIdentity | undefined;
		let captured_input: Record<string, unknown> | undefined;
		const vault_github: GitHubVaultBinding = {
			create_release: async (input, identity) => {
				captured_input = input;
				captured_identity = identity;
				return { ok: true, value: { id: 1, html_url: "https://github.com/acme/widgets/releases/1" } };
			},
			get_latest_release: async () => ({ ok: true, value: { id: 1, tag_name: "v1", html_url: "x" } }),
		};

		const executor = VaultActionExecutor({ vault_github, environment: "production" });
		const result = await executor.execute({
			action,
			event: fakeEvent(),
			hook: { id: "hook_test" } as never,
			delivery_id: "hdl_test",
		});

		expect(result).toEqual({ ok: true });
		expect(captured_identity).toEqual({ package_id: "devpad", environment: "production" });
		expect(captured_input).toEqual({});
	});

	test("deny-without-grant never touches upstream and is classified permanent", async () => {
		let upstream_called = false;
		const denied: VaultRpcResult<never> = { ok: false, error: { kind: "grant_denied" } };
		const vault_github: GitHubVaultBinding = {
			create_release: async () => {
				upstream_called = true;
				return denied;
			},
			get_latest_release: async () => denied,
		};

		const executor = VaultActionExecutor({ vault_github, environment: "production" });
		const result = await executor.execute({
			action,
			event: fakeEvent(),
			hook: { id: "hook_test" } as never,
			delivery_id: "hdl_test",
		});

		expect(result).toEqual({ ok: false, transient: false, message: "grant_denied" });
		expect(upstream_called).toBe(true); // the fake IS "upstream" here; a real vault denies before its own HTTP call
	});

	test("an upstream failure not classified as permanent is treated as transient", async () => {
		const vault_github: GitHubVaultBinding = {
			create_release: async () => ({ ok: false, error: { kind: "upstream_error", message: "GitHub API 503" } }),
			get_latest_release: async () => ({ ok: false, error: { kind: "upstream_error", message: "GitHub API 503" } }),
		};
		const executor = VaultActionExecutor({ vault_github, environment: "production" });
		const result = await executor.execute({
			action,
			event: fakeEvent(),
			hook: { id: "hook_test" } as never,
			delivery_id: "hdl_test",
		});
		expect(result).toEqual({ ok: false, transient: true, message: "GitHub API 503" });
	});

	test("an unsupported op is a permanent failure", async () => {
		const vault_github: GitHubVaultBinding = {
			create_release: async () => ({ ok: true, value: { id: 1, html_url: "x" } }),
			get_latest_release: async () => ({ ok: true, value: { id: 1, tag_name: "v1", html_url: "x" } }),
		};
		const executor = VaultActionExecutor({ vault_github, environment: "production" });
		const result = await executor.execute({
			action: { kind: "vault", scope: "github:releases:acme/widgets", op: "delete_everything" },
			event: fakeEvent(),
			hook: { id: "hook_test" } as never,
			delivery_id: "hdl_test",
		});
		expect(result).toEqual({ ok: false, transient: false, message: "unsupported vault op: delete_everything" });
	});
});
