import { describe, expect, test } from "bun:test";
import { find_rollback_target, type VersionSetRef } from "../../rollback.js";

const ref = (id: string, created_at: string, deployed = true): VersionSetRef => ({
	version_set_id: id,
	deployed_successfully: deployed,
	created_at,
});

describe("find_rollback_target", () => {
	test("returns the most recent deployed predecessor", () => {
		const lineage: VersionSetRef[] = [
			ref("v1", "2026-05-01T00:00:00Z"),
			ref("v2", "2026-05-05T00:00:00Z"),
			ref("v3", "2026-05-10T00:00:00Z"),
		];
		const r = find_rollback_target(lineage, "v3");
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value.version_set_id).toBe("v2");
	});

	test("skips never-deployed entries", () => {
		const lineage: VersionSetRef[] = [
			ref("v1", "2026-05-01T00:00:00Z", true),
			ref("v2", "2026-05-05T00:00:00Z", false),
			ref("v3", "2026-05-10T00:00:00Z"),
		];
		const r = find_rollback_target(lineage, "v3");
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value.version_set_id).toBe("v1");
	});

	test("errors when there is no deployed predecessor", () => {
		const lineage: VersionSetRef[] = [ref("v1", "2026-05-01T00:00:00Z", false), ref("v2", "2026-05-05T00:00:00Z")];
		const r = find_rollback_target(lineage, "v2");
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.code).toBe("no_rollback_target");
	});

	test("errors on empty lineage", () => {
		const r = find_rollback_target([], "v1");
		expect(r.ok).toBe(false);
	});

	test("excludes the current version itself", () => {
		const lineage: VersionSetRef[] = [ref("v1", "2026-05-01T00:00:00Z"), ref("v2", "2026-05-05T00:00:00Z")];
		const r = find_rollback_target(lineage, "v2");
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value.version_set_id).toBe("v1");
	});

	test("sorts lineage regardless of input order", () => {
		const lineage: VersionSetRef[] = [
			ref("a", "2026-01-01T00:00:00Z"),
			ref("c", "2026-03-01T00:00:00Z"),
			ref("b", "2026-02-01T00:00:00Z"),
		];
		const r = find_rollback_target(lineage, "x");
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value.version_set_id).toBe("c");
	});
});
