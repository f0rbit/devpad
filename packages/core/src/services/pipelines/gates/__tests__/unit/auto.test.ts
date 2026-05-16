import { describe, expect, test } from "bun:test";
import type { StageContext } from "@devpad/pipeline-templates";
import { decide_auto } from "../../auto.js";

describe("decide_auto", () => {
	test("returns Pass verdict", () => {
		const ctx: StageContext = {
			run_id: "run_123",
			package: "my-package",
			version_set_id: "vs_456",
			from_stage: "staging",
			to_stage: "onebox",
			gate: { type: "auto" },
		};

		const verdict = decide_auto(ctx);
		expect(verdict.verdict).toBe("Pass");
	});

	test("returns Pass even with afterBake set", () => {
		const ctx: StageContext = {
			run_id: "run_123",
			package: "my-package",
			version_set_id: "vs_456",
			from_stage: "staging",
			to_stage: "onebox",
			gate: { type: "auto", afterBake: true },
		};

		const verdict = decide_auto(ctx);
		expect(verdict.verdict).toBe("Pass");
	});
});
