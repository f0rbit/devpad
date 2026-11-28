import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import { contracts_registry } from "./index.js";

const contracts_dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "contracts");

const contract_names = Object.keys(contracts_registry).toSorted();

const read_fixtures = (contract: string, side: "valid" | "invalid") => {
	const dir = join(contracts_dir, contract, side);
	return readdirSync(dir)
		.filter((name) => name.endsWith(".json"))
		.toSorted()
		.map((file) => {
			const key = file.split(".")[0] ?? "";
			const text = readFileSync(join(dir, file), "utf8");
			const raw: unknown = JSON.parse(text);
			return { file, key, raw };
		});
};

describe.each(contract_names)("contracts/%s fixtures", (contract) => {
	const registry = contracts_registry[contract];

	test("fixture directory exists and is non-empty on both sides", () => {
		expect(read_fixtures(contract, "valid").length).toBeGreaterThan(0);
		expect(read_fixtures(contract, "invalid").length).toBeGreaterThan(0);
	});

	test("every valid fixture parses against its registered schema", () => {
		for (const { file, key, raw } of read_fixtures(contract, "valid")) {
			const schema = registry[key];
			expect(schema, `${contract}/${file}: no schema registered for key "${key}"`).toBeDefined();
			if (schema === undefined) continue;
			const result = schema.safeParse(raw);
			expect(result.success, `${contract}/valid/${file} should parse`).toBe(true);
		}
	});

	test("every invalid fixture fails against its registered schema", () => {
		for (const { file, key, raw } of read_fixtures(contract, "invalid")) {
			const schema = registry[key];
			expect(schema, `${contract}/${file}: no schema registered for key "${key}"`).toBeDefined();
			if (schema === undefined) continue;
			const result = schema.safeParse(raw);
			expect(result.success, `${contract}/invalid/${file} should fail`).toBe(false);
		}
	});
});

describe("contracts regression: vault #14 caller keyed by `package`", () => {
	test("fails with a field-level error naming package_id", () => {
		const schema = contracts_registry["grants-check"].caller;
		expect(schema).toBeDefined();
		if (schema === undefined) return;

		const raw: unknown = {
			caller: { package: "x", environment: "staging", version_set_id: "vs_v1" },
			scope: "anthropic:messages",
		};
		const result = schema.safeParse(raw);
		expect(result.success).toBe(false);
		if (result.success) return;

		const package_id_issue = result.error.issues.find((issue) => issue.path.join(".") === "caller.package_id");
		expect(package_id_issue).toBeDefined();
		expect(package_id_issue?.message.toLowerCase()).toContain("required");

		const unrecognized = result.error.issues.find((issue) => issue.message.toLowerCase().includes("unrecognized"));
		expect(unrecognized).toBeDefined();
	});
});
