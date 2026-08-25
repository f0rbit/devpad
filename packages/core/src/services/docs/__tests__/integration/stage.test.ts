import { beforeEach, describe, expect, test } from "bun:test";
import { action, task_event } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { type Backend, create_memory_backend } from "@f0rbit/corpus";
import { eq } from "drizzle-orm";
import { push_document } from "../../store.js";
import { decide_checkpoint, request_checkpoint } from "../../signoff.js";
import { advance } from "../../stage.js";
import { create_test_db, seed_project, seed_task, seed_user } from "./helpers.js";

describe("stage — SDLC transitions gated by checkpoints (task A4.5)", () => {
	let db: Database;
	let backend: Backend;
	let owner_id: string;
	let project_id: string;

	beforeEach(async () => {
		db = create_test_db();
		backend = create_memory_backend();
		const owner = await seed_user(db);
		owner_id = owner.id;
		const project = await seed_project(db, owner_id);
		project_id = project.id;
	});

	async function approve_stage_checkpoint(task_id: string, checkpoint: "plan" | "types") {
		const requested = await request_checkpoint(
			db,
			{ project_id, subject_kind: "stage", subject_id: task_id, checkpoint, blocks: [] },
			{ owner_id, auth_channel: "api" },
		);
		if (!requested.ok) throw new Error("request failed");
		const decided = await decide_checkpoint(
			db,
			backend,
			requested.value.signoff.id,
			{ decision: "approved" },
			{ user_id: owner_id, auth_channel: "user" },
		);
		if (!decided.ok) throw new Error("decide failed");
	}

	test("a gated transition without its checkpoint is rejected, naming the missing checkpoint", async () => {
		const t = await seed_task(db, owner_id, { project_id, stage: "plan" });

		const result = await advance(db, t.id, "build", { actor: "api" });

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("conflict");
		expect(result.error.message).toContain("plan");
	});

	test("a gated transition succeeds once its checkpoint is approved", async () => {
		const t = await seed_task(db, owner_id, { project_id, stage: "plan" });
		await approve_stage_checkpoint(t.id, "plan");

		const result = await advance(db, t.id, "build", { actor: "api" });

		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value.stage).toBe("build");
	});

	test("review->deploy requires an approved types checkpoint", async () => {
		const t = await seed_task(db, owner_id, { project_id, stage: "review" });

		const result = await advance(db, t.id, "deploy", { actor: "api" });

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.message).toContain("types");
	});

	test("review->deploy additionally requires an approved design checkpoint when a design doc exists", async () => {
		const t = await seed_task(db, owner_id, { project_id, stage: "review" });
		await approve_stage_checkpoint(t.id, "types");

		const design_doc = await push_document(
			db,
			backend,
			{ project_id, task_id: t.id, kind: "design", title: "Design", html: "<p>design</p>" },
			"api",
		);
		if (!design_doc.ok) throw new Error("push failed");

		const blocked = await advance(db, t.id, "deploy", { actor: "api" });
		expect(blocked.ok).toBe(false);
		if (!blocked.ok) expect(blocked.error.message).toContain("design");

		const requested = await request_checkpoint(
			db,
			{ project_id, subject_kind: "doc_version", subject_id: design_doc.value.id, checkpoint: "design", blocks: [] },
			{ owner_id, auth_channel: "api" },
		);
		if (!requested.ok) throw new Error("request failed");
		const decided = await decide_checkpoint(
			db,
			backend,
			requested.value.signoff.id,
			{ decision: "approved" },
			{ user_id: owner_id, auth_channel: "user" },
		);
		expect(decided.ok).toBe(true);

		const allowed = await advance(db, t.id, "deploy", { actor: "api" });
		expect(allowed.ok).toBe(true);
	});

	test("review->deploy does not require a design checkpoint when no design doc exists", async () => {
		const t = await seed_task(db, owner_id, { project_id, stage: "review" });
		await approve_stage_checkpoint(t.id, "types");

		const result = await advance(db, t.id, "deploy", { actor: "api" });

		expect(result.ok).toBe(true);
	});

	test("override bypasses a gate, writes an audit action row, and marks the stage event override:true", async () => {
		const t = await seed_task(db, owner_id, { project_id, stage: "plan" });

		const result = await advance(db, t.id, "build", { actor: "user", override: true, reason: "hotfix" });

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.stage).toBe("build");

		const audit_rows = await db.select().from(action).where(eq(action.type, "ADVANCE_STAGE"));
		expect(audit_rows.length).toBeGreaterThanOrEqual(1);
		expect(audit_rows.some((r) => JSON.stringify(r.data).includes("hotfix"))).toBe(true);

		const events = await db.select().from(task_event).where(eq(task_event.subject_id, t.id));
		const stage_event = events.find((e) => e.kind === "stage.advanced");
		expect(stage_event).toBeDefined();
		expect(JSON.stringify(stage_event?.payload)).toContain('"override":true');
	});

	test("stage events land in the outbox for an ungated hop too", async () => {
		const t = await seed_task(db, owner_id, { project_id, stage: "ideate" });

		const result = await advance(db, t.id, "plan", { actor: "api" });
		expect(result.ok).toBe(true);

		const events = await db.select().from(task_event).where(eq(task_event.subject_id, t.id));
		expect(events.some((e) => e.kind === "stage.advanced")).toBe(true);
	});
});
