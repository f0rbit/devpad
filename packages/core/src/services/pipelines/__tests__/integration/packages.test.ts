import { beforeEach, describe, expect, test } from "bun:test";
import { pipeline_package, project } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { eq } from "drizzle-orm";
import { get_package, list_packages } from "../../packages.js";
import { create_test_db, seed_package, seed_user } from "./helpers.js";

const seed_project = async (db: Database, id: string, owner_id: string): Promise<void> => {
	const now = new Date().toISOString();
	await db.insert(project).values({
		id,
		project_id: id,
		owner_id,
		name: id,
		created_at: now,
		updated_at: now,
		created_by: "api",
		modified_by: "api",
		protected: false,
		deleted: false,
	} as never);
};

const link_package = async (db: Database, package_id: string, project_id: string): Promise<void> => {
	await db.update(pipeline_package).set({ project_id }).where(eq(pipeline_package.id, package_id));
};

describe("packages service — list_packages", () => {
	let db: Database;

	beforeEach(async () => {
		db = create_test_db();
	});

	test("returns empty array when no packages exist", async () => {
		const result = await list_packages(db);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toEqual([]);
	});

	test("returns all packages when no filter applied", async () => {
		const u = await seed_user(db);
		await seed_package(db, u.id, { id: "pipeline-package_a", name: "pkg-a" });
		await seed_package(db, u.id, { id: "pipeline-package_b", name: "pkg-b" });

		const result = await list_packages(db);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toHaveLength(2);
			expect(result.value.map(p => p.id).sort()).toEqual(["pipeline-package_a", "pipeline-package_b"]);
		}
	});

	test("filters by project_id when set", async () => {
		const u = await seed_user(db);
		await seed_project(db, "project_alpha", u.id);
		await seed_project(db, "project_beta", u.id);
		await seed_package(db, u.id, { id: "pipeline-package_a", name: "pkg-a" });
		await seed_package(db, u.id, { id: "pipeline-package_b", name: "pkg-b" });
		await link_package(db, "pipeline-package_a", "project_alpha");
		await link_package(db, "pipeline-package_b", "project_beta");

		const alpha = await list_packages(db, { project_id: "project_alpha" });
		expect(alpha.ok).toBe(true);
		if (alpha.ok) {
			expect(alpha.value).toHaveLength(1);
			expect(alpha.value[0].id).toBe("pipeline-package_a");
			expect(alpha.value[0].project_id).toBe("project_alpha");
		}
	});

	test("returns empty array when project_id has no matching packages", async () => {
		const u = await seed_user(db);
		await seed_package(db, u.id, { id: "pipeline-package_a", name: "pkg-a" });

		const result = await list_packages(db, { project_id: "project_does_not_exist" });
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toEqual([]);
	});
});

describe("packages service — get_package", () => {
	let db: Database;

	beforeEach(async () => {
		db = create_test_db();
	});

	test("returns the package when it exists", async () => {
		const u = await seed_user(db);
		const seeded = await seed_package(db, u.id, { id: "pipeline-package_a", name: "pkg-a" });

		const result = await get_package(db, seeded.id);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.id).toBe("pipeline-package_a");
			expect(result.value.name).toBe("pkg-a");
			expect(result.value.project_id).toBeNull();
		}
	});

	test("returns not_found for unknown id", async () => {
		const result = await get_package(db, "pipeline-package_does_not_exist");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect((result.error as { kind: string }).kind).toBe("not_found");
			expect((result.error as { resource: string }).resource).toBe("pipeline_package");
		}
	});
});
