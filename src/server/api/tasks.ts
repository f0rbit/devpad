import { CreateItemOptions, FetchedTask, TaskInclude } from "@/types/page-link";
import { Prisma, TASK_PROGRESS, TASK_VISIBILITY } from "@prisma/client";
import { Session } from "next-auth";
import { contextUserOwnsTask, getErrorMessage } from "src/utils/backend";
import { StringLiteral } from "typescript";
import { z } from "zod";

export async function createTask(task: CreateItemOptions, session: Session): Promise<{ data: FetchedTask | null; error: string | null }> {
	if (!session?.user?.id) return { data: null, error: "You must be signed in to create a project." };
    /** @todo if the task has a goal_id, verify that the user owns that goal. */
	try {
		const fetchedTask = (await prisma?.task.create({
			data: {
				title: task.title,
                owner_id: session?.user?.id,
                visibility: task?.visibility,
                progress: task?.progress,
                project_goal_id: task.goal_id,
				modules: { createMany: { data: task.modules } }
			},
            include: TaskInclude
		})) ?? { fetchedTask: null };
		if (!fetchedTask) return { data: null, error: "Project could not be created." };
		// createAction({ description: `Created project ${project.name}`, type: ACTION_TYPE.CREATE_PROJECT, owner_id: session?.user?.id, data: { project_id } }); // writes na action as history
		return { data: fetchedTask as FetchedTask, error: null };
	} catch (err) {
		return {
			data: null,
			error: getErrorMessage(err)
		};
	}
}

export async function deleteTask(id: string, session: Session): Promise<{ success: boolean; error: string | null }> {
	if (!prisma) return { success: false, error: "Database not connected." };
	if (!session?.user?.id) return { success: false, error: "You must be signed in to create a project." };
	try {
		if (!contextUserOwnsTask({ session, prisma }, id)) return { success: false, error: "You do not own this task." };
		const deletedTask = await prisma?.task.delete({
			where: { id: id },
		});
		if (!deletedTask) return { success: false, error: "Task could not be deleted." };
		// createAction({ description: `Deleted project ${project.name}`, type: ACTION_TYPE.DELETE_PROJECT, owner_id: session?.user?.id, data: { project_id } }); // writes na action as history
		return { success: true, error: null };
	} catch (err) {
		return {
			success: false,
			error: getErrorMessage(err)
		};
	}
}

export type UpdateTask = z.infer<typeof updateTaskValidation>;

export const updateTaskValidation = z.object({
	id: z.string(),
	title: z.string(),
	visibility: z.nativeEnum(TASK_VISIBILITY).default(TASK_VISIBILITY.PRIVATE),
	progress: z.nativeEnum(TASK_PROGRESS).default(TASK_PROGRESS.UNSTARTED),
	project_goal_id: z.string().nullish(),
	owner_id: z.string(),
	modules: z.array(z.object({
		type: z.string(),
		data: z.any()
	})),
	tags: z.array(z.object({
		id: z.string()
	}))
});


export async function updateTask(task: UpdateTask, session: Session): Promise<{ data: FetchedTask | null; error: string | null }> {
	if (!prisma) return { data: null, error: "Database not connected." };
	if (!session?.user?.id) return { data: null, error: "You must be signed in to create a project." };
	try {
		if (!contextUserOwnsTask({ session, prisma }, task.id)) return { data: null, error: "You do not own this task." };
		const fetchedTask = (await prisma?.task.update({
			where: { id: task.id },	
			data: {
				title: task.title,
				visibility: task?.visibility,
				progress: task?.progress,
				project_goal_id: task.project_goal_id,
				owner_id: session?.user?.id,
				modules: {
					upsert: task.modules.map(module => ({ where: { task_id_type: { task_id: task.id, type: module.type } }, create: { type: module.type, data: module.data as Prisma.InputJsonObject }, update: { data: module.data as Prisma.InputJsonObject } })) as Prisma.Enumerable<Prisma.TaskModuleUpsertWithWhereUniqueWithoutTaskInput>					
				},
				tags: {
					connect: task.tags.map(tag => ({ id: tag.id }))
				}
			},
            include: TaskInclude
		})) ?? { fetchedTask: null };
		if (!fetchedTask) return { data: null, error: "Project could not be created." };
		// createAction({ description: `Created project ${project.name}`, type: ACTION_TYPE.CREATE_PROJECT, owner_id: session?.user?.id, data: { project_id } }); // writes na action as history
		return { data: fetchedTask as FetchedTask, error: null };
	} catch (err) {
		return {
			data: null,
			error: getErrorMessage(err)
		};
	}
}