import { beforeEach, describe, expect, test } from "bun:test";
import type { Project, TaskWithDetails } from "@devpad/schema";
import { createUserSessionCookie } from "../shared/test-utils";
import { setupIntegration } from "../shared/base-integration-test";
import { TestDataFactory } from "./factories";
import { TEST_BASE_URL, TEST_USER_ID } from "./setup";

const t = setupIntegration();

async function decide_as_user(
	cookie: string,
	signoff_id: string,
	body: unknown,
): Promise<{ status: number; json: unknown }> {
	const res = await fetch(`${TEST_BASE_URL}/signoffs/${signoff_id}/decide`, {
		method: "POST",
		headers: { "content-type": "application/json", cookie },
		body: JSON.stringify(body),
	});
	return { status: res.status, json: await res.json() };
}

describe("Stage — SDLC transitions gated by checkpoints (task A4.5)", () => {
	let project: Project;
	let user_cookie: string;

	beforeEach(async () => {
		const created = await t.client.projects.create(TestDataFactory.createRealisticProject());
		if (!created.ok) throw new Error(`Failed to create project: ${created.error.message}`);
		t.cleanup.registerProject(created.value);
		project = created.value;

		const db_path = process.env.DATABASE_FILE;
		if (!db_path) throw new Error("DATABASE_FILE not set — integration setup must run first");
		user_cookie = await createUserSessionCookie(db_path);
	});

	async function create_task(): Promise<TaskWithDetails> {
		const result = await t.client.tasks.create({
			title: "Stage-tracked task",
			project_id: project.id,
			owner_id: TEST_USER_ID,
			progress: "UNSTARTED",
			priority: "MEDIUM",
		});
		if (!result.ok) throw new Error(`Failed to create task: ${result.error.message}`);
		t.cleanup.registerTask(result.value);
		return result.value;
	}

	async function approve_stage_checkpoint(task_id: string, checkpoint: "plan" | "types") {
		const requested = await t.client.signoffs.request({
			project_id: project.id,
			subject_kind: "stage",
			subject_id: task_id,
			checkpoint,
			blocks: [],
		});
		if (!requested.ok) throw new Error(`request failed: ${requested.error.message}`);
		const decided = await decide_as_user(user_cookie, requested.value.signoff.id, { decision: "approved" });
		expect(decided.status).toBe(200);
	}

	test("a gated transition without its checkpoint is rejected, naming the missing checkpoint", async () => {
		const created = await create_task();
		const advanced_to_plan = await t.client.tasks.advanceStage(created.task.id, { to: "plan" });
		expect(advanced_to_plan.ok).toBe(true);

		const result = await t.client.tasks.advanceStage(created.task.id, { to: "build" });
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.message).toContain("plan");
	});

	test("override bypasses the gate, writes an audit action row, and marks the stage event override:true", async () => {
		const created = await create_task();
		const to_plan = await t.client.tasks.advanceStage(created.task.id, { to: "plan" });
		expect(to_plan.ok).toBe(true);

		const result = await t.client.tasks.advanceStage(created.task.id, {
			to: "build",
			override: true,
			reason: "hotfix",
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.stage).toBe("build");

		const history = await t.client.tasks.history.get(created.task.id);
		expect(history.ok).toBe(true);
		if (!history.ok) return;
		expect(history.value.some((h) => h.type === "ADVANCE_STAGE")).toBe(true);
	});

	test("a gated transition succeeds once its checkpoint is approved, unblocking the stage advance", async () => {
		const created = await create_task();
		const to_plan = await t.client.tasks.advanceStage(created.task.id, { to: "plan" });
		expect(to_plan.ok).toBe(true);
		await approve_stage_checkpoint(created.task.id, "plan");

		const result = await t.client.tasks.advanceStage(created.task.id, { to: "build" });
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value.stage).toBe("build");
	});
});
