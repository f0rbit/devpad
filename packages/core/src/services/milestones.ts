import type { UpsertMilestone } from "@devpad/schema";
import type { ActionType } from "@devpad/schema/database";
import { milestoneRepository, type Milestone } from "../data/milestone-repository";
import { log } from "../utils/logger";

export async function getUserMilestones(user_id: string): Promise<Milestone[]> {
	return milestoneRepository.getUserMilestones(user_id);
}

export type { Milestone };

export async function getMilestone(milestone_id: string): Promise<{ milestone: Milestone | null; error: string | null }> {
	return milestoneRepository.getMilestone(milestone_id);
}

export async function getProjectMilestones(project_id: string): Promise<Milestone[]> {
	return milestoneRepository.getProjectMilestones(project_id);
}

export async function upsertMilestone(data: UpsertMilestone, owner_id: string): Promise<Milestone> {
	log.projects("🏗️ [upsertMilestone] Called with:", {
		hasId: !!data.id,
		projectId: data.project_id,
		name: data.name,
		ownerId: owner_id,
		targetVersion: data.target_version,
	});

	const result = await milestoneRepository.upsertMilestone(data, owner_id);

	log.projects("✅ [upsertMilestone] Repository upsert completed", {
		milestoneId: result.id,
		milestoneName: result.name,
	});

	return result;
}

export async function deleteMilestone(milestone_id: string, owner_id: string): Promise<void> {
	log.projects("🗑️ [deleteMilestone] Called with:", {
		milestoneId: milestone_id,
		ownerId: owner_id,
	});

	await milestoneRepository.deleteMilestone(milestone_id, owner_id);

	log.projects("✅ [deleteMilestone] Milestone soft deleted");
}

export async function completeMilestone(milestone_id: string, owner_id: string, target_version?: string): Promise<Milestone> {
	log.projects("🎉 [completeMilestone] Called with:", {
		milestoneId: milestone_id,
		ownerId: owner_id,
		targetVersion: target_version,
	});

	const result = await milestoneRepository.completeMilestone(milestone_id, owner_id, target_version);

	log.projects("✅ [completeMilestone] Milestone completed", {
		milestoneId: result.id,
		finishedAt: result.finished_at,
		targetVersion: result.target_version,
	});

	return result;
}

export async function addMilestoneAction(data: { owner_id: string; milestone_id: string; type: ActionType; description: string }): Promise<boolean> {
	// TODO: Implement milestone action tracking
	// For now, just log the action
	log.projects("📝 [addMilestoneAction] Action logged:", {
		type: data.type,
		description: data.description,
		milestoneId: data.milestone_id,
	});
	return true;
}
