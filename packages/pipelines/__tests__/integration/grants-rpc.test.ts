import { beforeEach, describe, expect, test } from "bun:test";
import { pipeline_grant } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { PipelinesGrantsService } from "../../src/grants-rpc.ts";
import { create_test_db, seed_package, seed_user } from "./helpers.ts";

const seed_grant = async (db: Database, overrides: { package_id: string; stage_name: string; scope: string; granted_at?: string | null; id?: string }): Promise<void> => {
	const now = new Date().toISOString();
	await db.insert(pipeline_grant).values({
		id: overrides.id ?? `pipeline-grant_${crypto.randomUUID()}`,
		package_id: overrides.package_id,
		stage_name: overrides.stage_name,
		scope: overrides.scope,
		granted_at: overrides.granted_at === undefined ? now : overrides.granted_at,
		granted_by: overrides.granted_at === null ? null : "user_test",
		created_at: now,
		updated_at: now,
		created_by: "api",
		modified_by: "api",
		protected: false,
		deleted: false,
	} as never);
};

describe("PipelinesGrantsService.check — RPC contract consumed by vault", () => {
	let db: Database;
	let service: PipelinesGrantsService;
	let package_id: string;

	beforeEach(async () => {
		db = create_test_db();
		const u = await seed_user(db);
		const pkg = await seed_package(db, u.id);
		package_id = pkg.id;
		service = new PipelinesGrantsService(db);
	});

	test("returns granted=true when an approved grant matches package/stage/scope", async () => {
		await seed_grant(db, { package_id, stage_name: "staging", scope: "anthropic:messages" });

		const result = await service.check({ package: package_id, environment: "staging", version_set_id: "vs_v1" }, "anthropic:messages");

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.granted).toBe(true);
		expect(result.value.reason).toBeUndefined();
	});

	test("returns granted=false with reason when no matching grant exists", async () => {
		const result = await service.check({ package: package_id, environment: "production", version_set_id: "vs_v1" }, "anthropic:messages");

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.granted).toBe(false);
		expect(result.value.reason).toBeDefined();
		expect(result.value.reason).toContain("anthropic:messages");
	});

	test("returns granted=false when a grant exists but is unapproved (granted_at null)", async () => {
		await seed_grant(db, { package_id, stage_name: "staging", scope: "anthropic:messages", granted_at: null });

		const result = await service.check({ package: package_id, environment: "staging", version_set_id: "vs_v1" }, "anthropic:messages");

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.granted).toBe(false);
	});

	test("returns granted=false when grant is for a different stage", async () => {
		await seed_grant(db, { package_id, stage_name: "staging", scope: "anthropic:messages" });

		const result = await service.check({ package: package_id, environment: "production", version_set_id: "vs_v1" }, "anthropic:messages");

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.granted).toBe(false);
	});

	test("respects wildcard grants on the trailing scope segment", async () => {
		await seed_grant(db, { package_id, stage_name: "staging", scope: "github:read:my-org/*" });

		const result = await service.check({ package: package_id, environment: "staging", version_set_id: "vs_v1" }, "github:read:my-org/repo-x");

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.granted).toBe(true);
	});

	test("returns invalid_caller when package missing", async () => {
		const result = await service.check({ package: "", environment: "staging", version_set_id: "vs_v1" }, "anthropic:messages");
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("invalid_caller");
	});

	test("returns invalid_caller when environment missing", async () => {
		const result = await service.check({ package: package_id, environment: "", version_set_id: "vs_v1" }, "anthropic:messages");
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("invalid_caller");
	});

	test("returns invalid_caller when version_set_id missing", async () => {
		const result = await service.check({ package: package_id, environment: "staging", version_set_id: "" }, "anthropic:messages");
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("invalid_caller");
	});

	test("returns invalid_caller when scope missing", async () => {
		const result = await service.check({ package: package_id, environment: "staging", version_set_id: "vs_v1" }, "");
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("invalid_caller");
	});

	test("returns granted=false for unknown package (treated as deny, not error)", async () => {
		const result = await service.check({ package: "pipeline-package_unknown", environment: "staging", version_set_id: "vs_v1" }, "anthropic:messages");
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.granted).toBe(false);
	});
});
