import type { UpsertMilestone } from "@devpad/schema";
import { db, milestone, project } from "@devpad/schema/database/server";
import { and, desc, eq } from "drizzle-orm";
import { BaseRepository } from "./base-repository";
import { goalRepository } from "./goal-repository";
import { log } from "../utils/logger";

export type Milestone = typeof milestone.$inferSelect;

export class MilestoneRepository extends BaseRepository<typeof milestone, Milestone, UpsertMilestone> {
	constructor() {
		super(milestone);
	}

	async getUserMilestones(user_id: string): Promise<Milestone[]> {
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
			log.error("Error getting user milestones:", error);
			return [];
		}
	}

	async getProjectMilestones(project_id: string): Promise<Milestone[]> {
		try {
			const result = await this.findWhere([eq(milestone.project_id, project_id), eq(milestone.deleted, false)]);

			// Sort by creation date, but respect after_id ordering if present
			return result.sort((a, b) => {
				// If 'a' comes after 'b', a should be later in the list
				if (a.after_id === b.id) return 1;
				if (b.after_id === a.id) return -1;
				// Otherwise sort by creation date
				return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
			});
		} catch (error) {
			log.error("Error getting project milestones:", error);
			return [];
		}
	}

	async getMilestone(milestone_id: string): Promise<{ milestone: Milestone | null; error: string | null }> {
		try {
			const result = await this.findById(milestone_id);
			if (!result || result.deleted) {
				return { milestone: null, error: "Milestone not found" };
			}
			return { milestone: result, error: null };
		} catch (error) {
			log.error("Error getting milestone:", error);
			return { milestone: null, error: "Internal server error" };
		}
	}

	async upsertMilestone(data: UpsertMilestone, owner_id: string): Promise<Milestone> {
		log.projects("🏗️ [MilestoneRepository] upsertMilestone called", {
			hasId: !!data.id,
			projectId: data.project_id,
			name: data.name,
			ownerId: owner_id,
		});

		// Check if milestone exists
		const existing = data.id ? await this.findById(data.id) : null;

		// Verify project ownership
		const projectResult = await db.select().from(project).where(eq(project.id, data.project_id)).limit(1);

		if (!projectResult.length) {
			throw new Error("Project not found");
		}

		if (projectResult[0].owner_id !== owner_id) {
			throw new Error("Unauthorized: User does not own this project");
		}

		// Verify milestone ownership if updating
		if (existing) {
			// Get milestone's project owner through project relationship
			const milestoneProject = await db.select({ owner_id: project.owner_id }).from(milestone).innerJoin(project, eq(milestone.project_id, project.id)).where(eq(milestone.id, existing.id)).limit(1);

			if (!milestoneProject.length || milestoneProject[0].owner_id !== owner_id) {
				throw new Error("Unauthorized: User does not own this milestone");
			}
		}

		const final_data = {
			...data,
			id: data.id === "" || data.id == null ? undefined : data.id,
			updated_at: new Date().toISOString(),
		};

		// Remove null values
		const clean_data = Object.fromEntries(Object.entries(final_data).filter(([_, value]) => value !== null)) as typeof final_data;

		let result: Milestone | null = null;

		if (existing && clean_data.id) {
			// Update existing milestone
			result = await this.updateById(clean_data.id, clean_data);
		} else {
			// Create new milestone
			try {
				const res = await db
					.insert(milestone)
					.values(clean_data as any)
					.onConflictDoUpdate({
						target: [milestone.id],
						set: clean_data as any,
					})
					.returning();

				result = (res[0] as Milestone) || null;
			} catch (error) {
				log.error("Error creating milestone:", error);
				throw error;
			}
		}

		if (!result) {
			throw new Error("Milestone upsert failed");
		}

		log.projects("✅ [MilestoneRepository] Milestone upserted successfully", {
			milestoneId: result.id,
			milestoneName: result.name,
		});

		return result;
	}

	async deleteMilestone(milestone_id: string, owner_id: string): Promise<void> {
		// Verify ownership through project relationship
		const milestoneProject = await db.select({ owner_id: project.owner_id }).from(milestone).innerJoin(project, eq(milestone.project_id, project.id)).where(eq(milestone.id, milestone_id)).limit(1);

		if (!milestoneProject.length) {
			throw new Error("Milestone not found");
		}

		if (milestoneProject[0].owner_id !== owner_id) {
			throw new Error("Unauthorized: User does not own this milestone");
		}

		// First, cascade delete all goals associated with this milestone
		try {
			await goalRepository.deleteGoalsByMilestone(milestone_id, owner_id);
		} catch (error) {
			log.error("Error deleting goals for milestone:", error);
			// Continue with milestone deletion even if goal deletion fails
		}

		// Soft delete the milestone
		await this.updateById(milestone_id, {
			deleted: true,
			updated_at: new Date().toISOString(),
		} as any);
	}

	async completeMilestone(milestone_id: string, owner_id: string, target_version?: string): Promise<Milestone> {
		// Verify ownership
		const milestoneProject = await db.select({ owner_id: project.owner_id }).from(milestone).innerJoin(project, eq(milestone.project_id, project.id)).where(eq(milestone.id, milestone_id)).limit(1);

		if (!milestoneProject.length) {
			throw new Error("Milestone not found");
		}

		if (milestoneProject[0].owner_id !== owner_id) {
			throw new Error("Unauthorized: User does not own this milestone");
		}

		const update_data = {
			finished_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
			...(target_version && { target_version }),
		};

		const result = await this.updateById(milestone_id, update_data as any);

		if (!result) {
			throw new Error("Failed to complete milestone");
		}

		return result;
	}
}

// Create singleton instance
export const milestoneRepository = new MilestoneRepository();
