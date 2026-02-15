import type { Goal, UpsertGoal } from "@devpad/schema";
import type { ActionType } from "@devpad/schema/database";
import { goal, milestone, project } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { err, ok, type Result } from "@f0rbit/corpus";
import { and, desc, eq } from "drizzle-orm";
import type { ServiceError } from "./errors.js";
import { getMilestone } from "./milestones.js";
import { doesUserOwnProject } from "./projects.js";

export async function getUserGoals(db: Database, user_id: string): Promise<Result<Goal[], ServiceError>> {
	const result = await db
		.select({ goal })
		.from(goal)
		.innerJoin(milestone, eq(goal.milestone_id, milestone.id))
		.innerJoin(project, eq(milestone.project_id, project.id))
		.where(and(eq(project.owner_id, user_id), eq(goal.deleted, false)))
		.orderBy(desc(goal.created_at));

	return ok(result.map((r: any) => r.goal));
}

export async function getMilestoneGoals(db: Database, milestone_id: string): Promise<Result<Goal[], ServiceError>> {
	const result = await db
		.select()
		.from(goal)
		.where(and(eq(goal.milestone_id, milestone_id), eq(goal.deleted, false)))
		.orderBy(desc(goal.created_at));

	return ok(result);
}

export async function getGoal(db: Database, goal_id: string): Promise<Result<Goal | null, ServiceError>> {
	const result = await db.select().from(goal).where(eq(goal.id, goal_id));

	const record = result[0];
	if (!record || record.deleted) return err({ kind: "not_found", resource: "goal", id: goal_id });
	return ok(record);
}

export async function upsertGoal(db: Database, data: UpsertGoal, owner_id: string, auth_channel: "user" | "api" = "user"): Promise<Result<Goal, ServiceError>> {
	const previous_result = data.id ? await getGoal(db, data.id) : null;
	const previous = previous_result?.ok ? previous_result.value : null;

	const milestone_result = await getMilestone(db, data.milestone_id);
	if (!milestone_result.ok) return milestone_result;
	if (!milestone_result.value) return err({ kind: "not_found", resource: "milestone", id: data.milestone_id });

	const owns_result = await doesUserOwnProject(db, owner_id, milestone_result.value.project_id);
	if (!owns_result.ok) return owns_result;
	if (!owns_result.value) return err({ kind: "forbidden", reason: "User does not own this project" });

	if (previous && previous.deleted) {
		return err({ kind: "bad_request", message: "Cannot modify deleted goal" });
	}

	if (auth_channel === "api" && previous?.protected && !data.force) {
		return err({ kind: "protected", entity_id: previous.id, message: `Goal ${previous.id} is protected. Pass force=true to override.`, modified_by: previous.modified_by, modified_at: previous.updated_at });
	}

	const exists = !!previous;
	const { id: raw_id, force: _force, ...fields } = data;
	const id = raw_id === "" || raw_id == null ? undefined : raw_id;
	const protection = auth_channel === "user" ? { protected: true } : data.force ? { protected: false } : {};
	const provenance = exists ? { modified_by: auth_channel, ...protection } : { created_by: auth_channel, modified_by: auth_channel };
	const upsert = { ...fields, ...(id ? { id } : {}), updated_at: new Date().toISOString(), ...provenance };

	let result: Goal | null = null;
	if (exists && id) {
		const update_result = await db.update(goal).set(upsert).where(eq(goal.id, id)).returning();
		result = update_result[0] || null;
	} else {
		const insert_result = await db
			.insert(goal)
			.values(upsert)
			.onConflictDoUpdate({ target: [goal.id], set: upsert })
			.returning();
		result = insert_result[0] || null;
	}

	if (!result) return err({ kind: "db_error", message: "Goal upsert failed" });
	return ok(result);
}

export async function deleteGoal(db: Database, goal_id: string, owner_id: string): Promise<Result<void, ServiceError>> {
	const goal_result = await getGoal(db, goal_id);
	if (!goal_result.ok) return goal_result;
	if (!goal_result.value) return err({ kind: "not_found", resource: "goal", id: goal_id });

	const milestone_result = await getMilestone(db, goal_result.value.milestone_id);
	if (!milestone_result.ok) return milestone_result;
	if (!milestone_result.value) return err({ kind: "not_found", resource: "milestone", id: goal_result.value.milestone_id });

	const owns_result = await doesUserOwnProject(db, owner_id, milestone_result.value.project_id);
	if (!owns_result.ok) return owns_result;
	if (!owns_result.value) return err({ kind: "forbidden", reason: "User does not own this project" });

	await db.update(goal).set({ deleted: true, updated_at: new Date().toISOString() }).where(eq(goal.id, goal_id));

	return ok(undefined);
}

export async function completeGoal(db: Database, goal_id: string, owner_id: string, auth_channel: "user" | "api" = "user"): Promise<Result<Goal, ServiceError>> {
	const data: Partial<UpsertGoal> = {
		id: goal_id,
		finished_at: new Date().toISOString(),
	};

	return upsertGoal(db, data as UpsertGoal, owner_id, auth_channel);
}

export async function addGoalAction(_db: Database, _data: { owner_id: string; goal_id: string; type: ActionType; description: string; channel?: "user" | "api" }): Promise<Result<boolean, ServiceError>> {
	return ok(true);
}
