import type { UpsertMilestone } from "@devpad/schema";
import type { ActionType } from "@devpad/schema/database";
import { milestoneRepository, type Milestone } from "../data/milestone-repository";

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
	return milestoneRepository.upsertMilestone(data, owner_id);
}

export async function deleteMilestone(milestone_id: string, owner_id: string): Promise<void> {
	await milestoneRepository.deleteMilestone(milestone_id, owner_id);
}

export async function completeMilestone(milestone_id: string, owner_id: string, target_version?: string): Promise<Milestone> {
	return milestoneRepository.completeMilestone(milestone_id, owner_id, target_version);
}

export async function addMilestoneAction(_data: { owner_id: string; milestone_id: string; type: ActionType; description: string }): Promise<boolean> {
	// TODO: Implement milestone action tracking
	return true;
}
