/**
 * Unit tests for src/pipelines-verify.ts's pure helpers — the
 * `runs start` flag validation (exactly-one-of version-set-id / sha,
 * 40-hex sha shape) and the `runs verify-dispatch` exit-code decision
 * (external deploy mode #155). The network path (`fetchDispatchesEnvelope`)
 * isn't unit tested here, matching the existing CLI convention of only
 * unit-testing pure helpers (see task-progress.test.ts).
 */

import { describe, expect, test } from "bun:test";
import { evaluate_dispatch_verification, is_sha_like, resolve_runs_start_flags } from "../../src/pipelines-verify";

const SHA_A = "a".repeat(40);

describe("is_sha_like", () => {
	test("accepts 40-hex", () => {
		expect(is_sha_like(SHA_A)).toBe(true);
		expect(is_sha_like("0123456789abcdef0123456789abcdef01234567")).toBe(true);
	});

	test("rejects non-sha shapes", () => {
		expect(is_sha_like("abc123")).toBe(false);
		expect(is_sha_like("A".repeat(40))).toBe(false); // uppercase
		expect(is_sha_like("g".repeat(40))).toBe(false); // non-hex
		expect(is_sha_like("a".repeat(39))).toBe(false); // 39 chars
		expect(is_sha_like("a".repeat(41))).toBe(false); // 41 chars
		expect(is_sha_like("")).toBe(false);
	});
});

describe("resolve_runs_start_flags", () => {
	test("external target: --sha → external", () => {
		const result = resolve_runs_start_flags({ package: "ext-pkg", sha: SHA_A });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toEqual({ kind: "external", package_id: "ext-pkg", commit_sha: SHA_A });
		}
	});

	test("orchestrated target: --version-set-id", () => {
		const result = resolve_runs_start_flags({ package: "pkg", versionSetId: "vs_v1" });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toEqual({ kind: "orchestrated", package_id: "pkg", version_set_id: "vs_v1" });
		}
	});

	test("missing package → error", () => {
		expect(resolve_runs_start_flags({ sha: SHA_A })).toEqual({ ok: false, error: "--package is required" });
	});

	test("both targets → mutually-exclusive error", () => {
		const result = resolve_runs_start_flags({ package: "pkg", versionSetId: "vs_v1", sha: SHA_A });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain("mutually exclusive");
	});

	test("neither target → error", () => {
		const result = resolve_runs_start_flags({ package: "pkg" });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain("exactly one of");
	});

	test("--sha not 40-hex → error", () => {
		const result = resolve_runs_start_flags({ package: "pkg", sha: "abc123" });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain("40-hex");
	});
});

describe("evaluate_dispatch_verification", () => {
	const envelope = (overrides: Record<string, unknown> = {}) => ({
		run_id: "pipeline-run_x",
		run_status: "deploying",
		commit_sha: SHA_A,
		dispatches: [{ stage_name: "production", commit_sha: SHA_A, status: "dispatched" }],
		...overrides,
	});

	test("all conditions hold → ok", () => {
		expect(evaluate_dispatch_verification(envelope(), { sha: SHA_A, stage: "production" })).toEqual({ ok: true });
	});

	test("unconfirmed run is still an accepted in-flight status", () => {
		expect(
			evaluate_dispatch_verification(envelope({ run_status: "unconfirmed" }), { sha: SHA_A, stage: "production" }),
		).toEqual({ ok: true });
	});

	test("run is a different commit → fails with both SHAs in the reason", () => {
		const sha_b = "b".repeat(40);
		const decision = evaluate_dispatch_verification(envelope({ commit_sha: sha_b }), {
			sha: SHA_A,
			stage: "production",
		});
		expect(decision.ok).toBe(false);
		if (!decision.ok) {
			expect(decision.reason).toContain(sha_b);
			expect(decision.reason).toContain(SHA_A);
		}
	});

	test("null commit_sha can never match the expected sha", () => {
		const decision = evaluate_dispatch_verification(envelope({ commit_sha: null }), {
			sha: SHA_A,
			stage: "production",
		});
		expect(decision.ok).toBe(false);
		if (!decision.ok) expect(decision.reason).toContain("(null)");
	});

	test("no dispatch row for the stage → fails", () => {
		const decision = evaluate_dispatch_verification(envelope({ dispatches: [] }), { sha: SHA_A, stage: "production" });
		expect(decision.ok).toBe(false);
		if (!decision.ok) expect(decision.reason).toContain('no pipeline_dispatch row for stage "production"');
	});

	test("dispatch row exists but not dispatched (claimed/failed) → fails quoting the status", () => {
		for (const status of ["claimed", "failed"]) {
			const decision = evaluate_dispatch_verification(
				envelope({ dispatches: [{ stage_name: "production", commit_sha: SHA_A, status }] }),
				{ sha: SHA_A, stage: "production" },
			);
			expect(decision.ok).toBe(false);
			if (!decision.ok) expect(decision.reason).toContain(`status "${status}"`);
		}
	});

	test("terminal run status → fails", () => {
		const decision = evaluate_dispatch_verification(envelope({ run_status: "completed" }), {
			sha: SHA_A,
			stage: "production",
		});
		expect(decision.ok).toBe(false);
		if (!decision.ok) expect(decision.reason).toContain('run status is "completed"');
	});
});
