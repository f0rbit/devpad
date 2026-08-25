import type { TaskWithDetails, UpdateData, UpsertTag, UpsertTodo } from "@devpad/schema";
import type { ActionType } from "@devpad/schema/database";
import { action, codebase_tasks, task, task_tag } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { err, ok, type Result } from "@f0rbit/corpus";
import { and, eq, inArray, type SQL, sql } from "drizzle-orm";
import { batchedQuery, D1_PARAM_LIMIT } from "./batch.js";
import type { ServiceError } from "./errors.js";
import { SqlCompletionEngine } from "./graph/completion.js";
import { get_task_row, type GraphConflictError } from "./graph/graph.js";
import { type EmitEventInput, write_with_event } from "./graph/outbox.js";
import { refresh_rollup_chain } from "./graph/rollup.js";
import { getTaskTags, upsertTag } from "./tags.js";

export type Task = TaskWithDetails;

async function fetchTasksWithDetails(
	db: Database,
	where_conditions: (SQL | undefined)[],
): Promise<Result<Task[], ServiceError>> {
	const fetched_tasks = await db
		.select()
		.from(task)
		.leftJoin(codebase_tasks, eq(task.codebase_task_id, codebase_tasks.id))
		.where(and(...where_conditions));

	const tasks: Task[] = fetched_tasks.map((t) => ({
		task: t.task,
		codebase_tasks: t.codebase_tasks,
		tags: [],
	}));

	const task_ids = tasks.map((t) => t.task.id);
	if (task_ids.length > 0) {
		const tags = await batchedQuery(
			task_ids,
			(condition) => db.select().from(task_tag).where(condition),
			task_tag.task_id,
		);

		const mapped_tags = new Map<string, string[]>();
		for (const t of tags) {
			const existing = mapped_tags.get(t.task_id) ?? [];
			existing.push(t.tag_id);
			mapped_tags.set(t.task_id, existing);
		}

		for (const t of tasks) {
			t.tags = mapped_tags.get(t.task.id) ?? [];
		}
	}

	return ok(tasks);
}

export async function getUserTasks(db: Database, user_id: string): Promise<Result<Task[], ServiceError>> {
	return fetchTasksWithDetails(db, [eq(task.owner_id, user_id)]);
}

export async function getProjectTasks(db: Database, project_id: string): Promise<Result<Task[], ServiceError>> {
	return fetchTasksWithDetails(db, [eq(task.project_id, project_id)]);
}

export async function getTasksByTag(db: Database, tag_id: string): Promise<Result<Task[], ServiceError>> {
	const task_tag_relations = await db
		.select({ task_id: task_tag.task_id })
		.from(task_tag)
		.where(eq(task_tag.tag_id, tag_id));
	const task_ids = task_tag_relations.map((rel) => rel.task_id);

	if (task_ids.length === 0) return ok([]);

	if (task_ids.length <= D1_PARAM_LIMIT) {
		return fetchTasksWithDetails(db, [inArray(task.id, task_ids)]);
	}

	const all_tasks: Task[] = [];
	for (let i = 0; i < task_ids.length; i += D1_PARAM_LIMIT) {
		const chunk = task_ids.slice(i, i + D1_PARAM_LIMIT);
		const result = await fetchTasksWithDetails(db, [inArray(task.id, chunk)]);
		if (!result.ok) return result;
		all_tasks.push(...result.value);
	}
	return ok(all_tasks);
}

export async function getTask(db: Database, task_id: string): Promise<Result<Task | null, ServiceError>> {
	const tasks_result = await fetchTasksWithDetails(db, [eq(task.id, task_id)]);
	if (!tasks_result.ok) return tasks_result;
	return ok(tasks_result.value[0] || null);
}

export async function addTaskAction(
	db: Database,
	{
		owner_id,
		task_id,
		title,
		type,
		description,
		project_id,
		channel = "user",
	}: {
		owner_id: string;
		task_id: string;
		title: string;
		type: ActionType;
		description: string;
		project_id: string | null;
		channel?: "user" | "api";
	},
): Promise<Result<boolean, ServiceError>> {
	await db.insert(action).values({
		owner_id,
		type,
		description,
		data: { task_id, project_id: project_id ?? undefined, title },
		channel,
	});
	return ok(true);
}

export async function getUpsertedTaskMap(
	db: Database,
	codebase_items: UpdateData[],
): Promise<Result<Map<string, string>, ServiceError>> {
	const result = new Map<string, string>();
	if (codebase_items.length === 0) return ok(result);

	const item_ids = codebase_items.map((item) => item.id);
	const existing_tasks = await batchedQuery(
		item_ids,
		(condition) => db.select().from(task).where(condition),
		task.codebase_task_id,
	);

	for (const t of existing_tasks) {
		if (t.codebase_task_id) {
			result.set(t.codebase_task_id, t.id);
		}
	}

	return ok(result);
}

async function upsertTaskTags(db: Database, task_id: string, tags: string[]): Promise<void> {
	const current_result = await getTaskTags(db, task_id);
	const current = current_result.ok ? current_result.value.map((c) => c.id) : [];

	const create = tags.filter((tag_id) => !current.includes(tag_id));
	const delete_tags = current.filter((id) => !tags.includes(id));

	if (delete_tags.length > 0) {
		await db.delete(task_tag).where(and(eq(task_tag.task_id, task_id), inArray(task_tag.tag_id, delete_tags)));
	}

	if (create.length > 0) {
		const insert_tags = create.map((t) => ({ task_id, tag_id: t }));
		await db.insert(task_tag).values(insert_tags);
	}

	await db
		.update(task_tag)
		.set({ updated_at: sql`CURRENT_TIMESTAMP` })
		.where(eq(task_tag.task_id, task_id));
}

export async function upsertTask(
	db: Database,
	data: UpsertTodo,
	tags: UpsertTag[],
	owner_id: string,
	auth_channel: "user" | "api" = "user",
): Promise<Result<Task | null, ServiceError | GraphConflictError>> {
	const previous_result = data.id ? await getTask(db, data.id) : null;
	const previous = previous_result?.ok ? (previous_result.value?.task ?? null) : null;

	if (data.owner_id && data.owner_id !== owner_id) {
		return err({ kind: "forbidden", reason: "owner_id mismatch" });
	}

	if (previous && previous.owner_id !== owner_id) {
		return err({ kind: "forbidden", reason: "User does not own this task" });
	}

	if (auth_channel === "api" && previous?.protected && !data.force) {
		return err({
			kind: "protected",
			entity_id: previous.id,
			message: `Task ${previous.id} is protected. Pass force=true to override.`,
			modified_by: previous.modified_by,
			modified_at: previous.updated_at,
		});
	}

	if (data.goal_id) {
		const { getGoal } = await import("./goals.js");
		const goal_result = await getGoal(db, data.goal_id);
		if (!goal_result.ok || !goal_result.value) {
			return err({ kind: "bad_request", message: `Goal with id ${data.goal_id} does not exist` });
		}

		const task_project_id = data.project_id ?? previous?.project_id;
		const { getMilestone } = await import("./milestones.js");
		const milestone_result = await getMilestone(db, goal_result.value.milestone_id);
		if (!milestone_result.ok || !milestone_result.value) {
			return err({ kind: "bad_request", message: `Milestone for goal ${data.goal_id} does not exist` });
		}
		if (milestone_result.value.project_id !== task_project_id) {
			return err({ kind: "bad_request", message: `Goal ${data.goal_id} belongs to different project than task` });
		}
	}

	let tag_ids: string[] = [];
	if (tags.length > 0) {
		const results = await Promise.all(tags.map((t) => upsertTag(db, t)));
		const failed = results.find((r) => !r.ok);
		if (failed) return err(failed.error);
		tag_ids = results.filter((r) => r.ok).map((r) => r.value);
	}

	const exists = !!previous;
	const project_id = data.project_id ?? previous?.project_id ?? null;

	const { id: raw_id, force: _force, ...fields } = data;
	const id = raw_id === "" || raw_id == null ? undefined : raw_id;
	const protection = auth_channel === "user" ? { protected: true } : data.force ? { protected: false } : {};
	const provenance = exists
		? { modified_by: auth_channel, ...protection }
		: { created_by: auth_channel, modified_by: auth_channel };
	const upsert = { ...fields, ...(id ? { id } : {}), updated_at: new Date().toISOString(), owner_id, ...provenance };

	// progress→COMPLETED is engine-owned (task A2.2, "single completion
	// entrypoint") — this write never sets progress/completed_via itself
	// when fresh_complete; it writes every OTHER field, then delegates the
	// actual transition (+ cascade + outbox events) to SqlCompletionEngine
	// below. `rev` is untouched by this legacy (non-OCC) path either way, so
	// `new_todo.rev` read after this write is still the correct base_rev.
	const fresh_complete = data.progress === "COMPLETED" && previous?.progress !== "COMPLETED";
	const changed_fields = Object.keys(fields).filter(
		(key) => (fields as Record<string, unknown>)[key] !== undefined && !(fresh_complete && key === "progress"),
	);
	const { progress: _progress_via_engine, ...upsert_sans_progress } = upsert;
	const write_payload = fresh_complete ? upsert_sans_progress : upsert;

	const target_parent = !exists && data.parent_id ? await get_task_row(db, data.parent_id) : null;
	const old_parent_id = previous?.parent_id ?? null;
	const parent_changed = exists && Object.hasOwn(fields, "parent_id") && fields.parent_id !== old_parent_id;

	const write_result = await write_with_event(
		db,
		async (): Promise<Result<Task["task"] | null, ServiceError>> => {
			if (exists && id) {
				const update_result = await db.update(task).set(write_payload).where(eq(task.id, id)).returning();
				if (update_result.length === 0) return ok(null);
				if (parent_changed) {
					const old_chain_result = await refresh_rollup_chain(db, old_parent_id);
					if (!old_chain_result.ok) return old_chain_result;
					const new_chain_result = await refresh_rollup_chain(db, update_result[0].parent_id);
					if (!new_chain_result.ok) return new_chain_result;
				}
				return ok(update_result[0]);
			}
			const insert_result = await db
				.insert(task)
				.values(write_payload)
				.onConflictDoUpdate({ target: [task.id], set: write_payload })
				.returning();
			if (insert_result.length === 0) return ok(null);
			const rollup_result = await refresh_rollup_chain(db, insert_result[0].parent_id);
			if (!rollup_result.ok) return rollup_result;
			return ok(insert_result[0]);
		},
		(row) => {
			if (!row) return null;
			const events: EmitEventInput[] = [];
			if (!exists) {
				events.push({
					kind: "task.created",
					subject_id: row.id,
					project_id: row.project_id,
					actor: auth_channel,
					payload: { kind: "task.created", title: row.title },
				});
				if (target_parent && target_parent.completed_via === "policy" && !fresh_complete) {
					events.push({
						kind: "node.completion_stale",
						subject_id: target_parent.id,
						project_id: target_parent.project_id,
						actor: "policy",
						payload: { kind: "node.completion_stale", child_id: row.id },
					});
				}
				return events;
			}
			if (changed_fields.length > 0) {
				events.push({
					kind: "task.updated",
					subject_id: row.id,
					project_id: row.project_id,
					actor: auth_channel,
					payload: { kind: "task.updated", fields: changed_fields },
				});
			}
			return events;
		},
	);
	if (!write_result.ok) return write_result;
	if (!write_result.value) return err({ kind: "db_error", message: "Task upsert failed" });

	const new_todo = write_result.value;

	if (fresh_complete) {
		const engine = new SqlCompletionEngine(db);
		const complete_result = await engine.complete(new_todo.id, auth_channel, new_todo.rev);
		if (!complete_result.ok) return complete_result;
	}

	const action_type: ActionType = !exists ? "CREATE_TASK" : "UPDATE_TASK";
	const action_desc = !exists ? "Created task" : fresh_complete ? "Completed task" : "Updated task";

	const action_result = await addTaskAction(db, {
		owner_id,
		task_id: new_todo.id,
		title: new_todo.title,
		type: action_type,
		description: action_desc,
		project_id,
		channel: auth_channel,
	});
	if (!action_result.ok) return action_result;

	if (tag_ids.length > 0) {
		await upsertTaskTags(db, new_todo.id, tag_ids);
	}

	return getTask(db, new_todo.id);
}
