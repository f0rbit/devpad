import type { Milestone, UpsertMilestone } from "@devpad/schema";
import type { ActionType } from "@devpad/schema/database";
import { db, milestone, project, goal } from "@devpad/schema/database/server";
import { and, desc, eq } from "drizzle-orm";

export async function getUserMilestones(user_id: string): Promise<Milestone[]> {
	try {
		// Get milestones for projects owned by the user
		const result = await db
			.select({ milestone: milestone })
			.from(milestone)
			.innerJoin(project, eq(milestone.project_id, project.id))
			.where(and(eq(project.owner_id, user_id), eq(milestone.deleted, false)))
			.orderBy(desc(milestone.created_at));

		return result.map(r => r.milestone);
	} catch (error) {
		return [];
	}
}

export async function getProjectMilestones(project_id: string): Promise<Milestone[]> {
	try {
		const result = await db
			.select()
			.from(milestone)
			.where(and(eq(milestone.project_id, project_id), eq(milestone.deleted, false)));

		// Sort by creation date, but respect after_id ordering if present
		return result.sort((a, b) => {
			// If 'a' comes after 'b', a should be later in the list
			if (a.after_id === b.id) return 1;
			if (b.after_id === a.id) return -1;
			// Otherwise sort by creation date
			return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
		});
	} catch (error) {
		return [];
	}
}

export async function getMilestone(milestone_id: string): Promise<{ milestone: Milestone | null; error: string | null }> {
	try {
		const result = await db.select().from(milestone).where(eq(milestone.id, milestone_id));

		const milestoneRecord = result[0];
		if (!milestoneRecord || milestoneRecord.deleted) {
			return { milestone: null, error: "Milestone not found" };
		}
		return { milestone: milestoneRecord, error: null };
	} catch (error) {
		return { milestone: null, error: "Internal server error" };
	}
}

export async function upsertMilestone(data: UpsertMilestone, owner_id: string): Promise<Milestone> {
	const previous = data.id ? (await getMilestone(data.id)).milestone : null;

	// Verify user owns the project
	const { doesUserOwnProject } = await import("./projects");
	const user_owns = await doesUserOwnProject(owner_id, data.project_id);
	if (!user_owns) {
		throw new Error("Unauthorized: User does not own this project");
	}

	// Authorize existing milestone
	if (previous && previous.deleted) {
		throw new Error("Cannot modify deleted milestone");
	}

	const exists = !!previous;
	const upsert = {
		...data,
		updated_at: new Date().toISOString(),
	};
	if (upsert.id === "" || upsert.id == null) delete upsert.id;

	let result: Milestone | null = null;
	if (exists && upsert.id) {
		// Perform update
		const updateResult = await db
			.update(milestone)
			.set(upsert as any)
			.where(eq(milestone.id, upsert.id))
			.returning();
		result = updateResult[0] || null;
	} else {
		// Perform insert
		const insertResult = await db
			.insert(milestone)
			.values(upsert as any)
			.onConflictDoUpdate({ target: [milestone.id], set: upsert as any })
			.returning();
		result = insertResult[0] || null;
	}

	if (!result) throw new Error("Milestone upsert failed");

	return result;
}

export async function deleteMilestone(milestone_id: string, owner_id: string): Promise<void> {
	const { milestone: milestoneRecord } = await getMilestone(milestone_id);
	if (!milestoneRecord) {
		throw new Error("Milestone not found");
	}

	// Verify user owns the project
	const { doesUserOwnProject } = await import("./projects");
	const user_owns = await doesUserOwnProject(owner_id, milestoneRecord.project_id);
	if (!user_owns) {
		throw new Error("Unauthorized: User does not own this project");
	}

	// First, soft delete all goals in this milestone
	await db
		.update(goal)
		.set({
			deleted: true,
			updated_at: new Date().toISOString(),
		})
		.where(eq(goal.milestone_id, milestone_id));

	// Then soft delete the milestone
	await db
		.update(milestone)
		.set({
			deleted: true,
			updated_at: new Date().toISOString(),
		})
		.where(eq(milestone.id, milestone_id));
}

export async function completeMilestone(milestone_id: string, owner_id: string, target_version?: string): Promise<Milestone> {
	const data: Partial<UpsertMilestone> = {
		id: milestone_id,
		finished_at: new Date().toISOString(),
	};

	if (target_version) {
		data.target_version = target_version;
	}

	return upsertMilestone(data as UpsertMilestone, owner_id);
}

export async function addMilestoneAction(_data: { owner_id: string; milestone_id: string; type: ActionType; description: string }): Promise<boolean> {
	// TODO: Implement milestone action tracking
	return true;
}
