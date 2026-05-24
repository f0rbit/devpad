import { beforeEach, describe, expect, test } from "bun:test";
import { pipeline_package, pipeline_run, project } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { eq } from "drizzle-orm";
import { create_package, delete_package, get_package, list_packages, update_package } from "../../packages.js";
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

const seed_run_for = async (db: Database, package_id: string, run_id = "pipeline-run_seed"): Promise<void> => {
	const now = new Date().toISOString();
	await db.insert(pipeline_run).values({
		id: run_id,
		package_id,
		version_set_id: "vs_v1",
		shape: "atomic",
		status: "queued",
		current_stage: null,
		resolved_rollout: { type: "atomic", stages: [] } as never,
		resolved_gates: {} as never,
		forced_atomic_reason: null,
		started_at: now,
		finished_at: null,
		created_at: now,
		updated_at: now,
		created_by: "api",
		modified_by: "api",
		protected: false,
		deleted: false,
	} as never);
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

describe("packages service — create_package", () => {
	let db: Database;

	beforeEach(async () => {
		db = create_test_db();
	});

	test("creates a new package and list_packages returns it", async () => {
		const u = await seed_user(db);
		const created = await create_package(db, {
			id: "pipeline-package_new",
			name: "new-pkg",
			owner_id: u.id,
			repo_url: "https://github.com/example/new-pkg",
		});
		expect(created.ok).toBe(true);
		if (created.ok) {
			expect(created.value.id).toBe("pipeline-package_new");
			expect(created.value.name).toBe("new-pkg");
			expect(created.value.repo_url).toBe("https://github.com/example/new-pkg");
			expect(created.value.project_id).toBeNull();
		}

		const listed = await list_packages(db);
		expect(listed.ok).toBe(true);
		if (listed.ok) expect(listed.value.map(p => p.id)).toContain("pipeline-package_new");
	});

	test("returns conflict when id already exists", async () => {
		const u = await seed_user(db);
		await seed_package(db, u.id, { id: "pipeline-package_dup", name: "dup" });

		const second = await create_package(db, {
			id: "pipeline-package_dup",
			name: "dup",
			owner_id: u.id,
		});
		expect(second.ok).toBe(false);
		if (!second.ok) {
			expect((second.error as { kind: string }).kind).toBe("conflict");
			expect((second.error as { resource: string }).resource).toBe("pipeline_package");
			expect((second.error as { id: string }).id).toBe("pipeline-package_dup");
		}
	});

	test("returns not_found when project_id does not exist", async () => {
		const u = await seed_user(db);
		const result = await create_package(db, {
			id: "pipeline-package_orphan",
			name: "orphan",
			owner_id: u.id,
			project_id: "project_missing",
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect((result.error as { kind: string }).kind).toBe("not_found");
			expect((result.error as { resource: string }).resource).toBe("project");
			expect((result.error as { id: string }).id).toBe("project_missing");
		}
	});
});

describe("packages service — update_package", () => {
	let db: Database;

	beforeEach(async () => {
		db = create_test_db();
	});

	test("updates only specified fields and preserves the rest", async () => {
		const u = await seed_user(db);
		const seeded = await seed_package(db, u.id, { id: "pipeline-package_u", name: "u", repo_url: "https://old.example/repo" });

		const updated = await update_package(db, seeded.id, { repo_url: "https://new.example/repo" });
		expect(updated.ok).toBe(true);
		if (updated.ok) {
			expect(updated.value.repo_url).toBe("https://new.example/repo");
			expect(updated.value.name).toBe("u");
			expect(updated.value.project_id).toBeNull();
		}
	});

	test("can set project_id when project exists", async () => {
		const u = await seed_user(db);
		await seed_project(db, "project_x", u.id);
		const seeded = await seed_package(db, u.id, { id: "pipeline-package_x", name: "x" });

		const updated = await update_package(db, seeded.id, { project_id: "project_x" });
		expect(updated.ok).toBe(true);
		if (updated.ok) expect(updated.value.project_id).toBe("project_x");
	});

	test("returns not_found for unknown package", async () => {
		const result = await update_package(db, "pipeline-package_missing", { repo_url: "https://example.com" });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect((result.error as { kind: string }).kind).toBe("not_found");
			expect((result.error as { resource: string }).resource).toBe("pipeline_package");
		}
	});
});

describe("packages service — delete_package", () => {
	let db: Database;

	beforeEach(async () => {
		db = create_test_db();
	});

	test("deletes a package with no runs", async () => {
		const u = await seed_user(db);
		const seeded = await seed_package(db, u.id, { id: "pipeline-package_del", name: "del" });

		const deleted = await delete_package(db, seeded.id);
		expect(deleted.ok).toBe(true);

		const after = await get_package(db, seeded.id);
		expect(after.ok).toBe(false);
		if (!after.ok) expect((after.error as { kind: string }).kind).toBe("not_found");
	});

	test("returns conflict when active runs exist", async () => {
		const u = await seed_user(db);
		const seeded = await seed_package(db, u.id, { id: "pipeline-package_busy", name: "busy" });
		await seed_run_for(db, seeded.id, "pipeline-run_a");
		await seed_run_for(db, seeded.id, "pipeline-run_b");

		const result = await delete_package(db, seeded.id);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const e = result.error as { kind: string; reason?: string; count?: number };
			expect(e.kind).toBe("conflict");
			expect(e.reason).toBe("active_runs");
			expect(e.count).toBe(2);
		}

		// Package row still present.
		const still = await get_package(db, seeded.id);
		expect(still.ok).toBe(true);
	});

	test("returns not_found for unknown id", async () => {
		const result = await delete_package(db, "pipeline-package_missing");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect((result.error as { kind: string }).kind).toBe("not_found");
			expect((result.error as { resource: string }).resource).toBe("pipeline_package");
		}
	});
});
