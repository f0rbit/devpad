import type { Goal, UpsertGoal } from "@devpad/schema";
import type { ActionType } from "@devpad/schema/database";
import { db, goal, milestone, project } from "@devpad/schema/database/server";
import { and, desc, eq } from "drizzle-orm";

export async function getUserGoals(user_id: string): Promise<Goal[]> {
	try {
		// Get goals for milestones in projects owned by the user
		const result = await db
			.select({ goal: goal })
			.from(goal)
			.innerJoin(milestone, eq(goal.milestone_id, milestone.id))
			.innerJoin(project, eq(milestone.project_id, project.id))
			.where(and(eq(project.owner_id, user_id), eq(goal.deleted, false)))
			.orderBy(desc(goal.created_at));

		return result.map(r => r.goal);
	} catch (error) {
		return [];
	}
}

export async function getMilestoneGoals(milestone_id: string): Promise<Goal[]> {
	try {
		const result = await db
			.select()
			.from(goal)
			.where(and(eq(goal.milestone_id, milestone_id), eq(goal.deleted, false)))
			.orderBy(desc(goal.created_at));

		return result;
	} catch (error) {
		return [];
	}
}

export async function getGoal(goal_id: string): Promise<{ goal: Goal | null; error: string | null }> {
	try {
		const result = await db.select().from(goal).where(eq(goal.id, goal_id));

		const goalRecord = result[0];
		if (!goalRecord || goalRecord.deleted) {
			return { goal: null, error: "Goal not found" };
		}
		return { goal: goalRecord, error: null };
	} catch (error) {
		return { goal: null, error: "Internal server error" };
	}
}

export async function upsertGoal(data: UpsertGoal, owner_id: string): Promise<Goal> {
	const previous = data.id ? (await getGoal(data.id)).goal : null;

	// Verify milestone exists and user has access
	const { getMilestone } = await import("./milestones");
	const { milestone: milestoneRecord } = await getMilestone(data.milestone_id);
	if (!milestoneRecord) {
		throw new Error("Milestone not found");
	}

	// Verify user owns the project
	const { doesUserOwnProject } = await import("./projects");
	const user_owns = await doesUserOwnProject(owner_id, milestoneRecord.project_id);
	if (!user_owns) {
		throw new Error("Unauthorized: User does not own this project");
	}

	// Authorize existing goal
	if (previous && previous.deleted) {
		throw new Error("Cannot modify deleted goal");
	}

	const exists = !!previous;
	const upsert = {
		...data,
		updated_at: new Date().toISOString(),
	};
	if (upsert.id === "" || upsert.id == null) delete upsert.id;

	let result: Goal | null = null;
	if (exists && upsert.id) {
		// Perform update
		const updateResult = await db
			.update(goal)
			.set(upsert as any)
			.where(eq(goal.id, upsert.id))
			.returning();
		result = updateResult[0] || null;
	} else {
		// Perform insert
		const insertResult = await db
			.insert(goal)
			.values(upsert as any)
			.onConflictDoUpdate({ target: [goal.id], set: upsert as any })
			.returning();
		result = insertResult[0] || null;
	}

	if (!result) throw new Error("Goal upsert failed");

	return result;
}

export async function deleteGoal(goal_id: string, owner_id: string): Promise<void> {
	const { goal: goalRecord } = await getGoal(goal_id);
	if (!goalRecord) {
		throw new Error("Goal not found");
	}

	// Verify user owns the project through milestone
	const { getMilestone } = await import("./milestones");
	const { milestone: milestoneRecord } = await getMilestone(goalRecord.milestone_id);
	if (!milestoneRecord) {
		throw new Error("Milestone not found");
	}

	const { doesUserOwnProject } = await import("./projects");
	const user_owns = await doesUserOwnProject(owner_id, milestoneRecord.project_id);
	if (!user_owns) {
		throw new Error("Unauthorized: User does not own this project");
	}

	// Soft delete
	await db
		.update(goal)
		.set({
			deleted: true,
			updated_at: new Date().toISOString(),
		})
		.where(eq(goal.id, goal_id));
}

export async function completeGoal(goal_id: string, owner_id: string): Promise<Goal> {
	const data: Partial<UpsertGoal> = {
		id: goal_id,
		finished_at: new Date().toISOString(),
	};

	return upsertGoal(data as UpsertGoal, owner_id);
}

export async function addGoalAction(_data: { owner_id: string; goal_id: string; type: ActionType; description: string }): Promise<boolean> {
	// TODO: Implement goal action tracking
	return true;
}
