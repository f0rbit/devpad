import type { UpsertGoal } from "@devpad/schema";
import type { ActionType } from "@devpad/schema/database";
import { goalRepository, type Goal } from "../data/goal-repository";

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
	return goalRepository.upsertGoal(data, owner_id);
}

export async function deleteGoal(goal_id: string, owner_id: string): Promise<void> {
	await goalRepository.deleteGoal(goal_id, owner_id);
}

export async function completeGoal(goal_id: string, owner_id: string): Promise<Goal> {
	return goalRepository.completeGoal(goal_id, owner_id);
}

export async function addGoalAction(_data: { owner_id: string; goal_id: string; type: ActionType; description: string }): Promise<boolean> {
	// TODO: Implement goal action tracking
	return true;
}
