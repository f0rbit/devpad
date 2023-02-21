import { FetchedGoal, TaskInclude } from "@/types/page-link";
import { ACTION_TYPE, ProjectGoal } from "@prisma/client";
import { Session } from "next-auth";
import { getErrorMessage } from "src/utils/backend";
import { finished } from "stream";
import { z } from "zod";
import { createAction } from "./action";

export async function getProjectGoals(project_id: string, session: Session): Promise<{ data: FetchedGoal[]; error: string }> {
	if (!session?.user?.id) return { data: [], error: "You must be signed in to delete a project." };
	if (!project_id) return { data: [], error: "You must declare a valid project_id." };
	try {
		const where = { owner_id: session?.user?.id, project_id, deleted: false };
		const goals = (await prisma?.projectGoal.findMany({ where, include: { tasks: { include: TaskInclude } } })) as FetchedGoal[];
		if (!goals) return { data: [], error: "No goals found!" };
		return { data: goals, error: "" };
	} catch (e: any) {
		return { error: getErrorMessage(e), data: [] };
	}
}

export async function createProjectGoal(goal: { name: string; description: string; target_time: string; project_id: string; target_version: string }, session: Session): Promise<{ data: ProjectGoal | null; error: string | null }> {
	if (!session?.user?.id) return { data: null, error: "You must be signed in to create a project goal." };
	if (!goal.name || goal.name.length <= 0) return { data: null, error: "You must declare a valid name." };
	try {
		const new_goal =
			(await prisma?.projectGoal.create({
				data: {
					...goal,
					target_time: new Date(goal.target_time),
					owner_id: session?.user?.id
				}
			})) ?? null;
		if (!goal) return { data: null, error: "Project goal could not be created." };
		createAction({ description: `Created goal "${goal.name}"`, type: ACTION_TYPE.CREATE_GOAL, owner_id: session?.user?.id, data: { project_id: goal.project_id } }); // writes na action as history
		return { data: new_goal, error: null };
	} catch (err) {
		return {
			data: null,
			error: getErrorMessage(err)
		};
	}
}

export const updateGoalValidation = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string().nullable(),
	target_time: z.date(),
	target_version: z.string().nullable(),
	finished_at: z.date().nullable().optional()
});

export type UpdateGoal = z.infer<typeof updateGoalValidation>;

export async function updateProjectGoal(goal: UpdateGoal, session: Session): Promise<{ data: FetchedGoal | null; error: string | null }> {
	if (!session?.user?.id) return { data: null, error: "You must be signed in to update a project goal." };
	if (!goal.id || goal.id.length <= 0) return { data: null, error: "You must declare a valid goal_id." };
	try {
		// check that the goal belongs to the user
		const old_goal = (await prisma?.projectGoal.findUnique({ where: { id: goal.id }, include: { tasks: true } })) as FetchedGoal;
		if (!old_goal || old_goal.owner_id !== session?.user?.id) return { data: null, error: "You do not have permission to update this goal." };
		const new_goal =
			((await prisma?.projectGoal.update({
				where: {
					id: goal.id
				},
				data: {
					description: goal.description,
					name: goal.name,
					target_time: goal.target_time,
					target_version: goal.target_version,
					finished_at: goal.finished_at
				},
				include: {
					tasks: true
				}
			})) as FetchedGoal) ?? null;
		if (!new_goal) return { data: null, error: "Project goal could not be updated." };
		// @ts-ignore - ignore date to string conversion errors
		createAction({ description: `Updated goal "${new_goal.name}"`, type: ACTION_TYPE.UPDATE_GOAL, owner_id: session?.user?.id, data: { project_id: new_goal.project_id, old_goal, new_goal } }); // writes na action as history
		return { data: new_goal, error: null };
	} catch (err) {
		return {
			data: null,
			error: getErrorMessage(err)
		};
	}
}

export async function deleteProjectGoal(goal_id: string, session: Session): Promise<{ success: boolean; error: string | null }> {
	if (!session?.user?.id) return { success: false, error: "You must be signed in to delete a project goal." };
	if (!goal_id || goal_id.length <= 0) return { success: false, error: "You must declare a valid goal_id." };
	try {
		// check that the goal belongs to the user
		const goal = await prisma?.projectGoal.findUnique({ where: { id: goal_id } });
		if (!goal || goal.owner_id !== session?.user?.id) return { success: false, error: "You do not have permission to delete this goal." };
		const { deleted, project_id, name } = (await prisma?.projectGoal.update({
			where: {
				id: goal_id
			},
			data: { deleted: true },
			select: { deleted: true, project_id: true, name: true }
		})) ?? { deleted: false };
		if (!deleted) return { success: false, error: "Project goal could not be deleted." };
		createAction({ description: `Deleted goal "${name}"`, type: ACTION_TYPE.DELETE_GOAL, owner_id: session?.user?.id, data: { project_id } }); // writes an action as history
		return { success: true, error: null };
	} catch (err) {
		return { success: false, error: getErrorMessage(err) };
	}
}
