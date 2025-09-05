import type { UpsertGoal } from "@devpad/schema";
import { db, goal, milestone, project } from "@devpad/schema/database/server";
import { and, desc, eq } from "drizzle-orm";
import { BaseRepository } from "./base-repository";
import { log } from "../utils/logger";

export type Goal = typeof goal.$inferSelect;

export class GoalRepository extends BaseRepository<typeof goal, Goal, UpsertGoal> {
	constructor() {
		super(goal);
	}

	async getUserGoals(user_id: string): Promise<Goal[]> {
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
			log.error("Error getting user goals:", error);
			return [];
		}
	}

	async getMilestoneGoals(milestone_id: string): Promise<Goal[]> {
		try {
			const result = await this.findWhere([eq(goal.milestone_id, milestone_id), eq(goal.deleted, false)]);

			// Sort by creation date
			return result.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
		} catch (error) {
			log.error("Error getting milestone goals:", error);
			return [];
		}
	}

	async getGoal(goal_id: string): Promise<{ goal: Goal | null; error: string | null }> {
		try {
			const result = await this.findById(goal_id);
			if (!result || result.deleted) {
				return { goal: null, error: "Goal not found" };
			}
			return { goal: result, error: null };
		} catch (error) {
			log.error("Error getting goal:", error);
			return { goal: null, error: "Internal server error" };
		}
	}

	async upsertGoal(data: UpsertGoal, owner_id: string): Promise<Goal> {
		log.projects("🎯 [GoalRepository] upsertGoal called", {
			hasId: !!data.id,
			milestoneId: data.milestone_id,
			name: data.name,
			ownerId: owner_id,
		});

		// Check if goal exists
		const existing = data.id ? await this.findById(data.id) : null;

		// Verify milestone ownership through project relationship
		const milestoneProject = await db.select({ owner_id: project.owner_id }).from(milestone).innerJoin(project, eq(milestone.project_id, project.id)).where(eq(milestone.id, data.milestone_id)).limit(1);

		if (!milestoneProject.length) {
			throw new Error("Milestone not found");
		}

		if (milestoneProject[0].owner_id !== owner_id) {
			throw new Error("Unauthorized: User does not own this milestone");
		}

		// Verify goal ownership if updating
		if (existing) {
			const goalMilestoneProject = await db
				.select({ owner_id: project.owner_id })
				.from(goal)
				.innerJoin(milestone, eq(goal.milestone_id, milestone.id))
				.innerJoin(project, eq(milestone.project_id, project.id))
				.where(eq(goal.id, existing.id))
				.limit(1);

			if (!goalMilestoneProject.length || goalMilestoneProject[0].owner_id !== owner_id) {
				throw new Error("Unauthorized: User does not own this goal");
			}
		}

		const final_data = {
			...data,
			id: data.id === "" || data.id == null ? undefined : data.id,
			updated_at: new Date().toISOString(),
		};

		// Remove null values
		const clean_data = Object.fromEntries(Object.entries(final_data).filter(([_, value]) => value !== null)) as typeof final_data;

		let result: Goal | null = null;

		if (existing && clean_data.id) {
			// Update existing goal
			result = await this.updateById(clean_data.id, clean_data);
		} else {
			// Create new goal
			try {
				const res = await db
					.insert(goal)
					.values(clean_data as any)
					.onConflictDoUpdate({
						target: [goal.id],
						set: clean_data as any,
					})
					.returning();

				result = (res[0] as Goal) || null;
			} catch (error) {
				log.error("Error creating goal:", error);
				throw error;
			}
		}

		if (!result) {
			throw new Error("Goal upsert failed");
		}

		log.projects("✅ [GoalRepository] Goal upserted successfully", {
			goalId: result.id,
			goalName: result.name,
		});

		return result;
	}

	async deleteGoal(goal_id: string, owner_id: string): Promise<void> {
		// Verify ownership through milestone/project relationship
		const goalMilestoneProject = await db
			.select({ owner_id: project.owner_id })
			.from(goal)
			.innerJoin(milestone, eq(goal.milestone_id, milestone.id))
			.innerJoin(project, eq(milestone.project_id, project.id))
			.where(eq(goal.id, goal_id))
			.limit(1);

		if (!goalMilestoneProject.length) {
			throw new Error("Goal not found");
		}

		if (goalMilestoneProject[0].owner_id !== owner_id) {
			throw new Error("Unauthorized: User does not own this goal");
		}

		// Soft delete
		await this.updateById(goal_id, {
			deleted: true,
			updated_at: new Date().toISOString(),
		} as any);
	}

	async completeGoal(goal_id: string, owner_id: string): Promise<Goal> {
		// Verify ownership
		const goalMilestoneProject = await db
			.select({ owner_id: project.owner_id })
			.from(goal)
			.innerJoin(milestone, eq(goal.milestone_id, milestone.id))
			.innerJoin(project, eq(milestone.project_id, project.id))
			.where(eq(goal.id, goal_id))
			.limit(1);

		if (!goalMilestoneProject.length) {
			throw new Error("Goal not found");
		}

		if (goalMilestoneProject[0].owner_id !== owner_id) {
			throw new Error("Unauthorized: User does not own this goal");
		}

		const update_data = {
			finished_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
		};

		const result = await this.updateById(goal_id, update_data as any);

		if (!result) {
			throw new Error("Failed to complete goal");
		}

		return result;
	}
}

// Create singleton instance
export const goalRepository = new GoalRepository();
