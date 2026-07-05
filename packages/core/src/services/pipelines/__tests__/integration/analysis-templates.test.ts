/**
 * @module core/services/pipelines/__tests__/integration/analysis-templates
 *
 * Integration tests for the analysis-template CRUD service. Exercises the
 * full surface against bun:sqlite + the real Drizzle schema. Covers:
 *
 * - happy paths for list / get / create / update / delete
 * - owner_id scoping (mismatched owner reads as not_found)
 * - threshold_dsl parse validation surfacing as `validation_error`
 * - partial-update semantics (unspecified fields preserved)
 * - delete does NOT consult `pipeline_run.resolved_gates`
 */

import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "@devpad/schema/database/types";
import {
	create_analysis_template,
	delete_analysis_template,
	get_analysis_template,
	list_analysis_templates,
	update_analysis_template,
} from "../../analysis-templates.js";
import { create_test_db, seed_analysis_template, seed_user } from "./helpers.js";

describe("analysis-templates service — list_analysis_templates", () => {
	let db: Database;

	beforeEach(async () => {
		db = create_test_db();
	});

	test("returns empty array when owner has no templates", async () => {
		const u = await seed_user(db);
		const result = await list_analysis_templates(db, { owner_id: u.id });
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toEqual([]);
	});

	test("returns all templates for the owner", async () => {
		const u = await seed_user(db);
		await seed_analysis_template(db, u.id, { id: "pipeline-analysis-template_a", name: "tmpl-a" });
		await seed_analysis_template(db, u.id, { id: "pipeline-analysis-template_b", name: "tmpl-b" });

		const result = await list_analysis_templates(db, { owner_id: u.id });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toHaveLength(2);
			expect(result.value.map((t) => t.id).sort()).toEqual([
				"pipeline-analysis-template_a",
				"pipeline-analysis-template_b",
			]);
		}
	});

	test("does not return templates owned by another user", async () => {
		const owner = await seed_user(db, "user_owner");
		const other = await seed_user(db, "user_other");
		await seed_analysis_template(db, owner.id, { id: "pipeline-analysis-template_mine", name: "mine" });
		await seed_analysis_template(db, other.id, { id: "pipeline-analysis-template_theirs", name: "theirs" });

		const result = await list_analysis_templates(db, { owner_id: owner.id });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toHaveLength(1);
			expect(result.value[0].id).toBe("pipeline-analysis-template_mine");
		}
	});
});

describe("analysis-templates service — get_analysis_template", () => {
	let db: Database;

	beforeEach(async () => {
		db = create_test_db();
	});

	test("returns the template when it exists and owner matches", async () => {
		const u = await seed_user(db);
		const seeded = await seed_analysis_template(db, u.id, { id: "pipeline-analysis-template_a", name: "tmpl-a" });

		const result = await get_analysis_template(db, { id: seeded.id, owner_id: u.id });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.id).toBe(seeded.id);
			expect(result.value.name).toBe("tmpl-a");
		}
	});

	test("returns not_found for unknown id", async () => {
		const u = await seed_user(db);
		const result = await get_analysis_template(db, { id: "pipeline-analysis-template_missing", owner_id: u.id });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect((result.error as { kind: string }).kind).toBe("not_found");
			expect((result.error as { resource: string }).resource).toBe("pipeline_analysis_template");
		}
	});

	test("returns not_found when owner does not match", async () => {
		const owner = await seed_user(db, "user_owner");
		const other = await seed_user(db, "user_other");
		const seeded = await seed_analysis_template(db, owner.id, { id: "pipeline-analysis-template_a", name: "tmpl-a" });

		const result = await get_analysis_template(db, { id: seeded.id, owner_id: other.id });
		expect(result.ok).toBe(false);
		if (!result.ok) expect((result.error as { kind: string }).kind).toBe("not_found");
	});
});

describe("analysis-templates service — create_analysis_template", () => {
	let db: Database;

	beforeEach(async () => {
		db = create_test_db();
	});

	test("creates a template and list returns it", async () => {
		const u = await seed_user(db);
		const created = await create_analysis_template(db, {
			id: "pipeline-analysis-template_new",
			owner_id: u.id,
			name: "new-tmpl",
			threshold_dsl: "error_rate < 0.01\np99_latency_ms > 500",
			window_ms: 300_000,
		});
		expect(created.ok).toBe(true);
		if (created.ok) {
			expect(created.value.id).toBe("pipeline-analysis-template_new");
			expect(created.value.name).toBe("new-tmpl");
			expect(created.value.window_ms).toBe(300_000);
		}

		const listed = await list_analysis_templates(db, { owner_id: u.id });
		expect(listed.ok).toBe(true);
		if (listed.ok) expect(listed.value.map((t) => t.id)).toContain("pipeline-analysis-template_new");
	});

	test("defaults window_ms to 600_000 when omitted", async () => {
		const u = await seed_user(db);
		const created = await create_analysis_template(db, {
			id: "pipeline-analysis-template_default_window",
			owner_id: u.id,
			name: "default-window",
			threshold_dsl: "error_rate < 0.01",
		});
		expect(created.ok).toBe(true);
		if (created.ok) expect(created.value.window_ms).toBe(600_000);
	});

	test("returns validation_error on threshold_dsl parse failure", async () => {
		const u = await seed_user(db);
		const result = await create_analysis_template(db, {
			id: "pipeline-analysis-template_bad",
			owner_id: u.id,
			name: "bad",
			threshold_dsl: "error_rate isnt 0.01",
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const e = result.error as { kind: string; field?: string; message?: string };
			expect(e.kind).toBe("validation_error");
			expect(e.field).toBe("threshold_dsl");
			expect(typeof e.message).toBe("string");
		}
	});

	test("returns conflict when id already exists", async () => {
		const u = await seed_user(db);
		await seed_analysis_template(db, u.id, { id: "pipeline-analysis-template_dup", name: "dup" });

		const second = await create_analysis_template(db, {
			id: "pipeline-analysis-template_dup",
			owner_id: u.id,
			name: "dup",
			threshold_dsl: "error_rate < 0.01",
		});
		expect(second.ok).toBe(false);
		if (!second.ok) {
			expect((second.error as { kind: string }).kind).toBe("conflict");
			expect((second.error as { resource: string }).resource).toBe("pipeline_analysis_template");
		}
	});
});

describe("analysis-templates service — update_analysis_template", () => {
	let db: Database;

	beforeEach(async () => {
		db = create_test_db();
	});

	test("updates only specified fields and preserves the rest", async () => {
		const u = await seed_user(db);
		const seeded = await seed_analysis_template(db, u.id, {
			id: "pipeline-analysis-template_u",
			name: "u",
			window_ms: 600_000,
		});

		const updated = await update_analysis_template(db, { id: seeded.id, owner_id: u.id, name: "renamed" });
		expect(updated.ok).toBe(true);
		if (updated.ok) {
			expect(updated.value.name).toBe("renamed");
			expect(updated.value.window_ms).toBe(600_000);
		}
	});

	test("can update threshold_dsl when valid", async () => {
		const u = await seed_user(db);
		const seeded = await seed_analysis_template(db, u.id, { id: "pipeline-analysis-template_t", name: "t" });

		const updated = await update_analysis_template(db, {
			id: seeded.id,
			owner_id: u.id,
			threshold_dsl: "error_rate < 0.005\np99_latency_ms < 200",
		});
		expect(updated.ok).toBe(true);
		if (updated.ok) expect(updated.value.threshold_dsl).toContain("0.005");
	});

	test("returns validation_error on threshold_dsl parse failure", async () => {
		const u = await seed_user(db);
		const seeded = await seed_analysis_template(db, u.id, { id: "pipeline-analysis-template_bad_u", name: "u" });

		const updated = await update_analysis_template(db, {
			id: seeded.id,
			owner_id: u.id,
			threshold_dsl: "garbage line with no operator",
		});
		expect(updated.ok).toBe(false);
		if (!updated.ok) {
			const e = updated.error as { kind: string; field?: string };
			expect(e.kind).toBe("validation_error");
			expect(e.field).toBe("threshold_dsl");
		}
	});

	test("returns not_found for unknown id", async () => {
		const u = await seed_user(db);
		const result = await update_analysis_template(db, {
			id: "pipeline-analysis-template_missing",
			owner_id: u.id,
			name: "x",
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect((result.error as { kind: string }).kind).toBe("not_found");
	});

	test("returns not_found when owner does not match", async () => {
		const owner = await seed_user(db, "user_owner");
		const other = await seed_user(db, "user_other");
		const seeded = await seed_analysis_template(db, owner.id, { id: "pipeline-analysis-template_x", name: "x" });

		const result = await update_analysis_template(db, { id: seeded.id, owner_id: other.id, name: "hijack" });
		expect(result.ok).toBe(false);
		if (!result.ok) expect((result.error as { kind: string }).kind).toBe("not_found");
	});
});

describe("analysis-templates service — delete_analysis_template", () => {
	let db: Database;

	beforeEach(async () => {
		db = create_test_db();
	});

	test("deletes a template and subsequent get returns not_found", async () => {
		const u = await seed_user(db);
		const seeded = await seed_analysis_template(db, u.id, { id: "pipeline-analysis-template_del", name: "del" });

		const deleted = await delete_analysis_template(db, { id: seeded.id, owner_id: u.id });
		expect(deleted.ok).toBe(true);

		const after = await get_analysis_template(db, { id: seeded.id, owner_id: u.id });
		expect(after.ok).toBe(false);
		if (!after.ok) expect((after.error as { kind: string }).kind).toBe("not_found");
	});

	test("returns not_found for unknown id", async () => {
		const u = await seed_user(db);
		const result = await delete_analysis_template(db, { id: "pipeline-analysis-template_missing", owner_id: u.id });
		expect(result.ok).toBe(false);
		if (!result.ok) expect((result.error as { kind: string }).kind).toBe("not_found");
	});

	test("returns not_found when owner does not match", async () => {
		const owner = await seed_user(db, "user_owner");
		const other = await seed_user(db, "user_other");
		const seeded = await seed_analysis_template(db, owner.id, { id: "pipeline-analysis-template_x", name: "x" });

		const result = await delete_analysis_template(db, { id: seeded.id, owner_id: other.id });
		expect(result.ok).toBe(false);
		if (!result.ok) expect((result.error as { kind: string }).kind).toBe("not_found");
	});
});
