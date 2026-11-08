/**
 * @module pipelines/__tests__/integration/vault-dispatcher
 *
 * Coverage for `make_vault_dispatcher` (#155): the production
 * `Dispatcher` backed by vault's `GitHubVault` service binding.
 *
 *   - forwards repo/workflow/ref/inputs verbatim
 *   - passes identity `{ package_id, environment: "production" }` from
 *     the dispatch input (CF bindings don't propagate caller env vars)
 *   - maps vault error kinds to `DispatchError` codes
 *   - `ok(undefined)` on vault success (never retries)
 */

import { describe, expect, test } from "bun:test";
import { err, ok } from "@f0rbit/corpus";
import type { DispatchInput } from "@devpad/core/services/pipelines";
import { make_vault_dispatcher } from "../../src/providers/vault-dispatcher";
import type { GitHubVaultBinding } from "../../src/bindings";

type RecordedCall = {
	input: { repo: string; workflow: string; ref: string; inputs: Record<string, string> };
	identity: { package_id: string; environment: string };
};

const DISPATCH_INPUT: DispatchInput = {
	package_id: "pipeline-package_ext",
	repo: "acme/my-pkg",
	workflow: "deploy.yml",
	ref: "main",
	inputs: { stage: "production", sha: "a".repeat(40), run_id: "pipeline-run_x" },
};

const make_fake_vault = (
	outcome: { ok: true } | { ok: false; error: unknown },
): { binding: GitHubVaultBinding; calls: RecordedCall[] } => {
	const calls: RecordedCall[] = [];
	const binding = {
		dispatch_workflow: async (
			input: { repo: string; workflow: string; ref: string; inputs: Record<string, string> },
			identity: { package_id: string; environment: string },
		) => {
			calls.push({ input, identity });
			if (outcome.ok) return ok({ dispatched: true as const });
			return err(outcome.error);
		},
	};
	return { binding: binding as unknown as GitHubVaultBinding, calls };
};

describe("make_vault_dispatcher", () => {
	test("forwards the dispatch inputs verbatim with production identity", async () => {
		const { binding, calls } = make_fake_vault({ ok: true });
		const dispatcher = make_vault_dispatcher(binding);

		const result = await dispatcher.dispatch(DISPATCH_INPUT);

		expect(result.ok).toBe(true);
		expect(calls).toHaveLength(1);
		const call = calls[0];
		expect(call.input).toEqual({
			repo: "acme/my-pkg",
			workflow: "deploy.yml",
			ref: "main",
			inputs: { stage: "production", sha: "a".repeat(40), run_id: "pipeline-run_x" },
		});
		expect(call.identity).toEqual({ package_id: "pipeline-package_ext", environment: "production" });
	});

	test("success resolves ok(undefined) — no retry, no second call", async () => {
		const { binding, calls } = make_fake_vault({ ok: true });
		const first = await make_vault_dispatcher(binding).dispatch(DISPATCH_INPUT);
		const second = await make_vault_dispatcher(binding).dispatch(DISPATCH_INPUT);
		expect([first.ok, second.ok]).toEqual([true, true]);
		expect(calls).toHaveLength(2); // only the two explicit dispatches
	});

	const failing = async (error: unknown) => {
		const { binding } = make_fake_vault({ ok: false, error: error as never });
		const result = await make_vault_dispatcher(binding).dispatch(DISPATCH_INPUT);
		expect(result.ok).toBe(false);
		return result.ok ? null : result.error;
	};

	test("grant_denied → unauthorized naming the scope", async () => {
		const e = await failing({ kind: "grant_denied", scope: "github:dispatch:acme/my-pkg/deploy.yml" });
		expect(e?.code).toBe("unauthorized");
		expect(e?.message).toContain("github:dispatch:acme/my-pkg/deploy.yml");
	});

	test("grant_check_failed → internal with vault message", async () => {
		const e = await failing({ kind: "grant_check_failed", message: "GITHUB_DISPATCH_TOKEN not provisioned" });
		expect(e?.code).toBe("internal");
		expect(e?.message).toContain("GITHUB_DISPATCH_TOKEN not provisioned");
	});

	test("invalid_input → validation", async () => {
		expect(await failing({ kind: "invalid_input", message: "bad ref" })).toEqual({
			code: "validation",
			message: "bad ref",
		});
	});

	test("upstream_error unwraps cause: not_found → actionable 404 message", async () => {
		const e = await failing({
			kind: "upstream_error",
			cause: { kind: "not_found", status: 404, message: "Not Found" },
		});
		expect(e?.code).toBe("not_found");
		expect(e?.message).toContain("GitHub returned 404: workflow not found");
		expect(e?.message).toContain("external_target.workflow");
	});

	test("upstream_error unauthorized/validation/rate_limited/internal/network", async () => {
		expect(
			(await failing({ kind: "upstream_error", cause: { kind: "unauthorized", status: 403, message: "x" } }))?.code,
		).toBe("unauthorized");
		expect(
			(await failing({ kind: "upstream_error", cause: { kind: "validation", status: 422, message: "no ref" } }))?.code,
		).toBe("validation");
		const rl = await failing({ kind: "upstream_error", cause: { kind: "rate_limited", status: 429, message: "x" } });
		expect(rl?.code).toBe("internal");
		expect(rl?.message).toContain("rate limit");
		expect(
			(await failing({ kind: "upstream_error", cause: { kind: "internal", status: 503, message: "x" } }))?.message,
		).toContain("503");
		expect((await failing({ kind: "upstream_error", cause: { kind: "network", message: "dns" } }))?.message).toContain(
			"dns",
		);
	});
});
