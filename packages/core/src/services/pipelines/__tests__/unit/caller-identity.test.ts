import { describe, expect, test } from "bun:test";
import { compute_caller_identity_vars, environment_for_stage } from "../../caller-identity";

describe("compute_caller_identity_vars", () => {
	test("returns the trio in fixed order with correct names and values", () => {
		const vars = compute_caller_identity_vars({
			package_name: "anthropic-search",
			environment: "production",
			version_set_id: "vs_v1",
		});
		expect(vars).toEqual([
			{ type: "plain_text", name: "CALLER_PACKAGE", text: "anthropic-search" },
			{ type: "plain_text", name: "CALLER_ENV", text: "production" },
			{ type: "plain_text", name: "CALLER_VERSION_SET_ID", text: "vs_v1" },
		]);
	});

	test("encodes the staging environment unchanged", () => {
		const vars = compute_caller_identity_vars({
			package_name: "anthropic-search",
			environment: "staging",
			version_set_id: "vs_v2",
		});
		expect(vars.find((v) => v.name === "CALLER_ENV")?.text).toBe("staging");
	});

	test("all three vars use the plain_text binding type vault expects", () => {
		const vars = compute_caller_identity_vars({
			package_name: "p",
			environment: "production",
			version_set_id: "vs",
		});
		for (const v of vars) {
			expect(v.type).toBe("plain_text");
		}
	});

	test("rejects blank package_name", () => {
		expect(() =>
			compute_caller_identity_vars({
				package_name: "",
				environment: "production",
				version_set_id: "vs_v1",
			}),
		).toThrow("package_name is required");
	});

	test("rejects whitespace-only package_name", () => {
		expect(() =>
			compute_caller_identity_vars({
				package_name: "   ",
				environment: "production",
				version_set_id: "vs_v1",
			}),
		).toThrow("package_name is required");
	});

	test("rejects blank version_set_id", () => {
		expect(() =>
			compute_caller_identity_vars({
				package_name: "p",
				environment: "production",
				version_set_id: "",
			}),
		).toThrow("version_set_id is required");
	});

	test("rejects invalid environment value", () => {
		expect(() =>
			compute_caller_identity_vars({
				package_name: "p",
				// @ts-expect-error — runtime guard for unknown environment
				environment: "dev",
				version_set_id: "vs",
			}),
		).toThrow(`environment must be "staging" or "production"`);
	});

	test("returns a fresh array each call (no shared mutable state)", () => {
		const a = compute_caller_identity_vars({ package_name: "p", environment: "production", version_set_id: "vs" });
		const b = compute_caller_identity_vars({ package_name: "p", environment: "production", version_set_id: "vs" });
		expect(a).not.toBe(b);
		a[0].text = "mutated";
		expect(b[0].text).toBe("p");
	});
});

describe("environment_for_stage", () => {
	test("staging stage maps to staging", () => {
		expect(environment_for_stage("staging")).toBe("staging");
	});

	test("any other stage maps to production", () => {
		const production_stages = ["onebox", "wave1", "wave2", "full", "atomic-prod", "prod-onebox"];
		for (const stage of production_stages) {
			expect(environment_for_stage(stage)).toBe("production");
		}
	});
});
