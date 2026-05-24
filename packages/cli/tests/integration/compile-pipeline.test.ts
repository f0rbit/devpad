/**
 * Integration tests for `compile_pipeline_ts` — the bundle + dynamic-
 * import path that consumes a real `pipeline.ts` on disk and produces a
 * typed PipelineTemplate.
 *
 * The fixtures live under `packages/cli/tests/golden/` and are the same
 * scaffolder-emitted shapes the demo packages (`anthropic-search`, the
 * gradual analysis demo) ship in production.
 */

import { describe, test, expect } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { compile_pipeline_ts } from "../../src/pipelines-artifacts-helpers";

const GOLDEN_DIR = path.resolve(import.meta.dir, "..", "golden");

describe("compile_pipeline_ts — real golden pipelines", () => {
	test("anthropic-search compiles to an atomic rollout", async () => {
		const result = await compile_pipeline_ts(path.join(GOLDEN_DIR, "anthropic-search", "pipeline.ts"));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.rollout.type).toBe("atomic");
		expect(result.value.gates["staging→atomic-prod"]).toEqual({ type: "auto" });
	});

	test("gradual-manual compiles with manual overrides on every transition", async () => {
		const result = await compile_pipeline_ts(path.join(GOLDEN_DIR, "gradual-manual", "pipeline.ts"));
		if (!result.ok) console.log("gradual-manual ERROR:", result.error);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.rollout.type).toBe("gradual");
		expect(result.value.gates["staging→onebox"]?.type).toBe("manual");
		expect(result.value.gates["onebox→wave1"]?.type).toBe("manual");
		expect(result.value.gates["wave1→wave2"]?.type).toBe("manual");
		expect(result.value.gates["wave2→full"]?.type).toBe("manual");
	});

	test("gradual-analysis compiles with analysis gates carrying template_id", async () => {
		const result = await compile_pipeline_ts(path.join(GOLDEN_DIR, "gradual-analysis", "pipeline.ts"));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.rollout.type).toBe("gradual");
		const gate = result.value.gates["staging→onebox"];
		expect(gate?.type).toBe("analysis");
		if (gate?.type !== "analysis") return;
		expect(gate.template.template_id).toBe("default");
	});
});

// Synthetic test fixtures live under the package tree so that
// `@devpad/pipeline-templates` resolves against the workspace's
// node_modules. Pure `tmpdir()` directories can't see the workspace
// symlinks and would fail with "Cannot find module" instead of the
// targeted error.
const make_synthetic_fixture = (name: string, source: string): string => {
	const dir = path.join(import.meta.dir, "..", "_synthetic", name);
	mkdirSync(dir, { recursive: true });
	const file_path = path.join(dir, "pipeline.ts");
	writeFileSync(file_path, source);
	return file_path;
};

const cleanup_synthetic = (): void => {
	rmSync(path.join(import.meta.dir, "..", "_synthetic"), { recursive: true, force: true });
};

describe("compile_pipeline_ts — error surfaces", () => {
	test("syntax error returns build_failed", async () => {
		try {
			const bad = make_synthetic_fixture("syntax-error", "this is not valid TypeScript {{{{\n");
			const result = await compile_pipeline_ts(bad);
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.error.kind).toBe("build_failed");
		} finally {
			cleanup_synthetic();
		}
	});

	test("pipeline.ts with a non-template default export returns not_a_template", async () => {
		try {
			const bad = make_synthetic_fixture("non-template", `export default { hello: "world" };\n`);
			const result = await compile_pipeline_ts(bad);
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.error.kind).toBe("not_a_template");
		} finally {
			cleanup_synthetic();
		}
	});

	test("pipeline.ts with no default export returns not_a_template", async () => {
		try {
			const bad = make_synthetic_fixture("no-default", `export const x = 1;\n`);
			const result = await compile_pipeline_ts(bad);
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.error.kind).toBe("not_a_template");
		} finally {
			cleanup_synthetic();
		}
	});

	test("pipeline.ts where extendTemplate fails returns dsl_error", async () => {
		try {
			const bad = make_synthetic_fixture(
				"dsl-error",
				`import { extendTemplate } from "@devpad/pipeline-templates";\nexport default extendTemplate({ rollout: { type: "gradual", stages: [{ name: "not-a-real-stage", traffic: 50 }] } });\n`,
			);
			const result = await compile_pipeline_ts(bad);
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.error.kind).toBe("dsl_error");
		} finally {
			cleanup_synthetic();
		}
	});
});
