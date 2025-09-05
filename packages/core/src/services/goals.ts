import type { UpsertGoal } from "@devpad/schema";
import type { ActionType } from "@devpad/schema/database";
import { goalRepository, type Goal } from "../data/goal-repository";
import { log } from "../utils/logger";

export async function getUserGoals(user_id: string): Promise<Goal[]> {
	return goalRepository.getUserGoals(user_id);
}

export type { Goal };

export async function getGoal(goal_id: string): Promise<{ goal: Goal | null; error: string | null }> {
	return goalRepository.getGoal(goal_id);
}

export async function getMilestoneGoals(milestone_id: string): Promise<Goal[]> {
	return goalRepository.getMilestoneGoals(milestone_id);
}

export async function upsertGoal(data: UpsertGoal, owner_id: string): Promise<Goal> {
	log.projects("🎯 [upsertGoal] Called with:", {
		hasId: !!data.id,
		milestoneId: data.milestone_id,
		name: data.name,
		ownerId: owner_id,
	});

	const result = await goalRepository.upsertGoal(data, owner_id);

	log.projects("✅ [upsertGoal] Repository upsert completed", {
		goalId: result.id,
		goalName: result.name,
	});

	return result;
}

export async function deleteGoal(goal_id: string, owner_id: string): Promise<void> {
	log.projects("🗑️ [deleteGoal] Called with:", {
		goalId: goal_id,
		ownerId: owner_id,
	});

	await goalRepository.deleteGoal(goal_id, owner_id);

	log.projects("✅ [deleteGoal] Goal soft deleted");
}

export async function completeGoal(goal_id: string, owner_id: string): Promise<Goal> {
	log.projects("🎉 [completeGoal] Called with:", {
		goalId: goal_id,
		ownerId: owner_id,
	});

	const result = await goalRepository.completeGoal(goal_id, owner_id);

	log.projects("✅ [completeGoal] Goal completed", {
		goalId: result.id,
		finishedAt: result.finished_at,
	});

	return result;
}

export async function addGoalAction(data: { owner_id: string; goal_id: string; type: ActionType; description: string }): Promise<boolean> {
	// TODO: Implement goal action tracking
	// For now, just log the action
	log.projects("📝 [addGoalAction] Action logged:", {
		type: data.type,
		description: data.description,
		goalId: data.goal_id,
	});
	return true;
}
