import type { Goal, Task, UpsertGoal } from "@devpad/schema";
import type { ActionType } from "@devpad/schema/database";
import { action, task } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { err, ok, type Result } from "@f0rbit/corpus";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { ServiceError } from "./errors.js";
import { getMilestone } from "./milestones.js";
import { SqlCompletionEngine } from "./graph/completion.js";
import type { GraphConflictError } from "./graph/graph.js";
import { write_with_event } from "./graph/outbox.js";
import { rank_between } from "./graph/rank.js";
import { refresh_rollup_chain } from "./graph/rollup.js";
import { doesUserOwnProject } from "./projects.js";

/**
 * v2.4 (task A5.2) — goals are a compat PROJECTION over `task` rows of
 * `kind='goal'`, parented (`parent_id`) under their milestone's task row.
 * Same compat contract as `milestones.ts`: every exported shape stays
 * byte-for-byte what it was before the fold. Goals never had an `after_id`
 * ordering concept in the frozen table (`getMilestoneGoals` only ever sorted
 * by `created_at DESC`) — new goals are always appended at the end of their
 * milestone's rank order; there is no reorder-by-position input.
 */

type GoalTaskRow = Task;

function goal_from_task(row: GoalTaskRow): Goal {
	return {
		id: row.id,
		milestone_id: row.parent_id ?? "",
		name: row.title,
		description: row.description,
		target_time: row.end_time,
		finished_at: row.progress === "COMPLETED" ? row.updated_at : null,
		created_at: row.created_at,
		updated_at: row.updated_at,
		deleted: row.deleted,
		created_by: row.created_by,
		modified_by: row.modified_by,
		protected: row.protected,
	};
}

async function get_goal_row(db: Database, goal_id: string): Promise<GoalTaskRow | null> {
	const rows = await db
		.select()
		.from(task)
		.where(and(eq(task.id, goal_id), eq(task.kind, "goal")));
	return rows[0] ?? null;
}

async function goal_siblings(db: Database, milestone_id: string): Promise<GoalTaskRow[]> {
	return db
		.select()
		.from(task)
		.where(and(eq(task.kind, "goal"), eq(task.parent_id, milestone_id), eq(task.deleted, false)))
		.orderBy(asc(task.rank), asc(task.created_at), desc(sql`rowid`));
}

export async function getUserGoals(db: Database, user_id: string): Promise<Result<Goal[], ServiceError>> {
	const rows = await db.all<GoalTaskRow>(sql`
		SELECT goal.* FROM task goal
		JOIN task milestone ON milestone.id = goal.parent_id
		JOIN project ON project.id = milestone.project_id
		WHERE project.owner_id = ${user_id} AND goal.kind = 'goal' AND goal.deleted = 0
		ORDER BY goal.created_at DESC, goal.rowid DESC
	`);
	return ok(rows.map(goal_from_task));
}

export async function getMilestoneGoals(db: Database, milestone_id: string): Promise<Result<Goal[], ServiceError>> {
	const rows = await db
		.select()
		.from(task)
		.where(and(eq(task.kind, "goal"), eq(task.parent_id, milestone_id), eq(task.deleted, false)))
		.orderBy(desc(task.created_at), desc(sql`rowid`));
	return ok(rows.map(goal_from_task));
}

export async function getGoal(db: Database, goal_id: string): Promise<Result<Goal | null, ServiceError>> {
	const row = await get_goal_row(db, goal_id);
	if (!row) return err({ kind: "not_found", resource: "goal", id: goal_id });
	if (row.deleted) return err({ kind: "not_found", resource: "goal", id: goal_id });
	return ok(goal_from_task(row));
}

export async function upsertGoal(
	db: Database,
	data: UpsertGoal,
	owner_id: string,
	auth_channel: "user" | "api" = "user",
): Promise<Result<Goal, ServiceError | GraphConflictError>> {
	const previous = data.id ? await get_goal_row(db, data.id) : null;
	const milestone_id = data.milestone_id;

	const milestone_result = await getMilestone(db, milestone_id);
	if (!milestone_result.ok) return milestone_result;
	if (!milestone_result.value) return err({ kind: "not_found", resource: "milestone", id: milestone_id });
	const milestone = milestone_result.value;

	const owns_result = await doesUserOwnProject(db, owner_id, milestone.project_id);
	if (!owns_result.ok) return owns_result;
	if (!owns_result.value) return err({ kind: "forbidden", reason: "User does not own this project" });

	if (previous?.deleted) {
		return err({ kind: "bad_request", message: "Cannot modify deleted goal" });
	}

	if (auth_channel === "api" && previous?.protected && !data.force) {
		return err({
			kind: "protected",
			entity_id: previous.id,
			message: `Goal ${previous.id} is protected. Pass force=true to override.`,
			modified_by: previous.modified_by,
			modified_at: previous.updated_at,
		});
	}

	const exists = !!previous;
	const rank = previous
		? previous.rank
		: rank_between((await goal_siblings(db, milestone_id)).at(-1)?.rank ?? null, null);

	const finished_at_provided = Object.hasOwn(data, "finished_at");
	const previously_completed = previous?.progress === "COMPLETED";
	const fresh_complete = finished_at_provided && data.finished_at != null && !previously_completed;
	const fresh_reopen = finished_at_provided && data.finished_at == null && previously_completed;

	const protection = auth_channel === "user" ? { protected: true } : data.force ? { protected: false } : {};
	const provenance = exists
		? { modified_by: auth_channel, ...protection }
		: { created_by: auth_channel, modified_by: auth_channel };

	// Only fields the caller actually supplied are written on an UPDATE — a
	// partial caller (`completeGoal` supplies `{id, milestone_id, name,
	// finished_at}`) must never blank out an unrelated field it didn't
	// mention, matching the pre-fold service's spread-whatever-was-given
	// semantics.
	const reopen_fields = fresh_reopen
		? ({ progress: "IN_PROGRESS", completed_via: null } satisfies { progress: "IN_PROGRESS"; completed_via: null })
		: {};
	const write_payload = {
		rank,
		updated_at: new Date().toISOString(),
		...(Object.hasOwn(data, "name") ? { title: data.name } : {}),
		...(Object.hasOwn(data, "description") ? { description: data.description ?? null } : {}),
		...(Object.hasOwn(data, "target_time") ? { end_time: data.target_time ?? null } : {}),
		...reopen_fields,
		...provenance,
	};

	const write_result = await write_with_event(
		db,
		async (): Promise<Result<GoalTaskRow | null, ServiceError>> => {
			if (previous) {
				const rows = await db.update(task).set(write_payload).where(eq(task.id, previous.id)).returning();
				return ok(rows[0] ?? null);
			}
			const id = data.id === "" || data.id == null ? `goal_${crypto.randomUUID()}` : data.id;
			const now = new Date().toISOString();
			const rows = await db
				.insert(task)
				.values({
					id,
					owner_id,
					title: data.name,
					progress: "UNSTARTED",
					visibility: "PRIVATE",
					kind: "goal",
					completion_policy: "manual",
					project_id: milestone.project_id,
					parent_id: milestone_id,
					rank,
					rev: 0,
					description: data.description ?? null,
					end_time: data.target_time ?? null,
					created_at: now,
					updated_at: now,
					created_by: auth_channel,
					modified_by: auth_channel,
					protected: auth_channel === "user",
				})
				.returning();
			return ok(rows[0] ?? null);
		},
		(row) =>
			row && {
				kind: exists ? "task.updated" : "task.created",
				subject_id: row.id,
				project_id: row.project_id,
				actor: auth_channel,
				payload: exists
					? { kind: "task.updated", fields: Object.keys(write_payload) }
					: { kind: "task.created", title: row.title },
			},
	);
	if (!write_result.ok) return write_result;
	if (!write_result.value) return err({ kind: "db_error", message: "Goal upsert failed" });

	let final_row = write_result.value;
	if (fresh_complete) {
		const engine = new SqlCompletionEngine(db);
		const complete_result = await engine.complete(final_row.id, auth_channel, final_row.rev);
		if (!complete_result.ok) return complete_result;
		final_row = complete_result.value.completed;
	}
	const rollup_result = await refresh_rollup_chain(db, final_row.parent_id);
	if (!rollup_result.ok) return rollup_result;

	const action_type: ActionType = !exists ? "CREATE_GOAL" : "UPDATE_GOAL";
	const action_desc = !exists ? "Created goal" : "Updated goal";
	const action_result = await addGoalAction(db, {
		owner_id,
		goal_id: final_row.id,
		milestone_id,
		project_id: milestone.project_id,
		name: final_row.title,
		type: action_type,
		description: action_desc,
		channel: auth_channel,
	});
	if (!action_result.ok) return action_result;

	return ok(goal_from_task(final_row));
}

export async function deleteGoal(
	db: Database,
	goal_id: string,
	owner_id: string,
	auth_channel: "user" | "api" = "user",
): Promise<Result<void, ServiceError>> {
	const goal_result = await getGoal(db, goal_id);
	if (!goal_result.ok) return goal_result;
	if (!goal_result.value) return err({ kind: "not_found", resource: "goal", id: goal_id });

	const milestone_result = await getMilestone(db, goal_result.value.milestone_id);
	if (!milestone_result.ok) return milestone_result;
	if (!milestone_result.value)
		return err({ kind: "not_found", resource: "milestone", id: goal_result.value.milestone_id });

	const owns_result = await doesUserOwnProject(db, owner_id, milestone_result.value.project_id);
	if (!owns_result.ok) return owns_result;
	if (!owns_result.value) return err({ kind: "forbidden", reason: "User does not own this project" });

	const action_result = await addGoalAction(db, {
		owner_id,
		goal_id,
		milestone_id: goal_result.value.milestone_id,
		project_id: milestone_result.value.project_id,
		name: goal_result.value.name,
		type: "DELETE_GOAL",
		description: "Deleted goal",
		channel: auth_channel,
	});
	if (!action_result.ok) return action_result;

	await db.update(task).set({ deleted: true, updated_at: new Date().toISOString() }).where(eq(task.id, goal_id));

	return ok(undefined);
}

export async function completeGoal(
	db: Database,
	goal_id: string,
	owner_id: string,
	auth_channel: "user" | "api" = "user",
): Promise<Result<Goal, ServiceError | GraphConflictError>> {
	const current = await getGoal(db, goal_id);
	if (!current.ok) return current;
	if (!current.value) return err({ kind: "not_found", resource: "goal", id: goal_id });

	return upsertGoal(
		db,
		{
			id: goal_id,
			milestone_id: current.value.milestone_id,
			name: current.value.name,
			finished_at: new Date().toISOString(),
		},
		owner_id,
		auth_channel,
	);
}

export async function addGoalAction(
	db: Database,
	{
		owner_id,
		goal_id,
		milestone_id,
		project_id,
		name,
		type,
		description,
		channel = "user",
	}: {
		owner_id: string;
		goal_id: string;
		milestone_id: string;
		project_id: string;
		name: string;
		type: ActionType;
		description: string;
		channel?: "user" | "api";
	},
): Promise<Result<boolean, ServiceError>> {
	await db.insert(action).values({
		owner_id,
		type,
		description,
		data: { project_id, milestone_id, goal_id, name },
		channel,
	});
	return ok(true);
}
