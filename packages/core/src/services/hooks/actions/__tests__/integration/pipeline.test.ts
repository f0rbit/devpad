import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "@devpad/schema/database/types";
import { task_link } from "@devpad/schema/database/schema";
import type { Project, Task, TaskEvent, User } from "@devpad/schema";
import { eq } from "drizzle-orm";
import { create_test_db, seed_project, seed_task, seed_user } from "../../../__tests__/integration/helpers.js";
import { PipelineActionExecutor } from "../../pipeline.js";

function fakeEvent(task: Task, project: Project): TaskEvent {
	return {
		id: 1,
		event_id: "evt_test",
		kind: "task.completed",
		subject_id: task.id,
		project_id: project.id,
		actor: "user",
		payload: { kind: "task.completed", via: "user" },
		occurred_at: "2026-01-01 00:00:00",
		dispatch_status: "pending",
		dispatched_at: null,
	} as TaskEvent;
}

describe("PipelineActionExecutor (task A3.4)", () => {
	let db: Database;
	let owner: User;
	let project: Project;
	let task: Task;

	beforeEach(async () => {
		db = create_test_db();
		owner = await seed_user(db);
		project = await seed_project(db, owner.id);
		task = await seed_task(db, owner.id, { project_id: project.id });
	});

	test("on success, records a `references` edge on the subject with ref {type: pipeline_run, run_id}", async () => {
		const executor = PipelineActionExecutor({
			orchestrator_base: "https://devpad-pipelines.example.dev",
			token: "test-token",
			db,
			fetch_impl: (async () => Response.json({ ok: true, value: { run_id: "pipeline-run_abc123" } })) as typeof fetch,
		});

		const result = await executor.execute({
			action: { kind: "pipeline", package_id: "anthropic-search" },
			event: fakeEvent(task, project),
			hook: { id: "hook_test" } as never,
			delivery_id: "hdl_test",
		});

		expect(result).toEqual({ ok: true });

		const links = await db.select().from(task_link).where(eq(task_link.src_id, task.id));
		expect(links.length).toBe(1);
		expect(links[0]?.kind).toBe("references");
		expect(links[0]?.dst_id).toBeNull();
		expect(links[0]?.ref).toEqual({ type: "pipeline_run", run_id: "pipeline-run_abc123" });
	});

	test("classifies a 5xx orchestrator response as transient and a 4xx as permanent", async () => {
		const make = (status: number) =>
			PipelineActionExecutor({
				orchestrator_base: "https://devpad-pipelines.example.dev",
				token: "test-token",
				db,
				fetch_impl: (async () => new Response(null, { status })) as typeof fetch,
			});

		const transient = await make(500).execute({
			action: { kind: "pipeline", package_id: "anthropic-search" },
			event: fakeEvent(task, project),
			hook: { id: "hook_test" } as never,
			delivery_id: "d1",
		});
		expect(transient).toEqual({ ok: false, transient: true, message: "orchestrator responded 500" });

		const permanent = await make(400).execute({
			action: { kind: "pipeline", package_id: "anthropic-search" },
			event: fakeEvent(task, project),
			hook: { id: "hook_test" } as never,
			delivery_id: "d2",
		});
		expect(permanent).toEqual({ ok: false, transient: false, message: "orchestrator responded 400" });
	});

	test("a network error is classified transient", async () => {
		const executor = PipelineActionExecutor({
			orchestrator_base: "https://devpad-pipelines.example.dev",
			token: "test-token",
			db,
			fetch_impl: (async () => {
				throw new Error("ECONNREFUSED");
			}) as typeof fetch,
		});
		const result = await executor.execute({
			action: { kind: "pipeline", package_id: "anthropic-search" },
			event: fakeEvent(task, project),
			hook: { id: "hook_test" } as never,
			delivery_id: "d3",
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.transient).toBe(true);
	});
});
