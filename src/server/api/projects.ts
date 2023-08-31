import { CreateProjectType, FetchedGoal, FetchedProject, TaskInclude } from "@/types/page-link";
import { Action, ACTION_TYPE, Project, Prisma, ProjectGoal, Task, PROJECT_STATUS, TASK_VISIBILITY } from "@prisma/client";
import { Session } from "next-auth";
import { getErrorMessage } from "src/utils/backend";
import { logger } from "src/utils/loggers";
import { getCurrentUser } from "src/utils/session";
import { optional, z } from "zod";
import { createAction, getHistory } from "./action";

const updateProjectValdiation = z.object({
	project_id: z.string(),
	name: z.string(),
	description: z.string().nullable(),
	status: z.nativeEnum(PROJECT_STATUS),
	current_version: z.string().optional().nullable(),
	deleted: z.boolean().default(false).optional(),
	icon_url: z.string().nullable(),
	link_url: z.string().nullable(),
	link_text: z.string().nullable(),
	repo_url: z.string().nullable(),
	specification: z.string().optional().nullable(),
    visibility: z.nativeEnum(TASK_VISIBILITY).optional().default(TASK_VISIBILITY.PRIVATE)
});

export type UpdateProject = z.infer<typeof updateProjectValdiation>;

export async function updateProject(project: UpdateProject, session: Session): Promise<{ data: FetchedProject | null; error: string | null }> {
	logger.debug("updateProject", { project, session });
	if (!session?.user?.id) return { data: null, error: "You must be signed in to update a project." };
	const where = { owner_id_project_id: { owner_id: session?.user?.id, project_id: project.project_id } };
	try {
		const old_project = (await prisma?.project.findUnique({ where, include: ProjectInclude })) as FetchedProject | null;
		if (!old_project) return { data: null, error: "Project could not be found." };
		const updatedProject =
			(await prisma?.project.update({
				where,
				data: {
					...project,
					updated_at: new Date()
				},
				include: ProjectInclude
			})) ?? null;
		if (!updatedProject) return { data: null, error: "Project could not be updated." };
		const new_project = updatedProject as FetchedProject;
		// @ts-ignore - ignore date to string conversion errors
		createAction({ description: `Updated project "${project.name}"`, type: ACTION_TYPE.UPDATE_PROJECT, owner_id: session?.user?.id, data: { project_id: project.project_id, new_project, old_project } }); // writes an action as history
		return { data: new_project, error: null };
	} catch (err) {
		return {
			data: null,
			error: getErrorMessage(err)
		};
	}
}

export async function createProject(project: CreateProjectType, session: Session): Promise<{ data: string | null; error: string | null }> {
	logger.debug("createProject", { project, session });
	if (!session?.user?.id) return { data: null, error: "You must be signed in to create a project." };
	try {
		const { project_id } = (await prisma?.project.create({
			data: {
				...project,
				owner_id: session?.user?.id
			},
			select: {
				project_id: true
			}
		})) ?? { project_id: null };
		if (!project_id) return { data: null, error: "Project could not be created." };
		createAction({ description: `Created project ${project.name}`, type: ACTION_TYPE.CREATE_PROJECT, owner_id: session?.user?.id, data: { project_id } }); // writes na action as history
		return { data: project_id, error: null };
	} catch (err) {
		return {
			data: null,
			error: getErrorMessage(err)
		};
	}
}

export async function deleteProject(project_id: string, session: Session): Promise<{ success: boolean; error: string | null }> {
	logger.debug("deleteProject", { project_id, session });
	if (!session?.user?.id) return { success: false, error: "You must be signed in to delete a project." };
	if (!project_id || project_id.length <= 0) return { success: false, error: "You must declare a valid project_id." };
	try {
		const { deleted } = (await prisma?.project.update({
			where: {
				owner_id_project_id: {
					owner_id: session?.user?.id,
					project_id
				}
			},
			data: { deleted: true },
			select: { deleted: true }
		})) ?? { deleted: false };
		if (!deleted) return { success: false, error: "Project could not be deleted." };
		createAction({ description: `Deleted project ${project_id}`, type: ACTION_TYPE.DELETE_PROJECT, owner_id: session?.user?.id, data: { project_id } }); // writes an action as history
		return { success: true, error: null };
	} catch (err) {
		return { success: false, error: getErrorMessage(err) };
	}
}

export async function getUserProjects({ includeDeleted }: { includeDeleted?: boolean }): Promise<{ data: FetchedProject[]; error: string }> {
	const user = await getCurrentUser();
	if (!user || !user.id) return { data: [], error: "Not logged in!" };
	try {
		const deleted = includeDeleted ? undefined : false;
		const projects = await prisma?.project.findMany({ where: { owner_id: user.id, deleted }, include: ProjectInclude });
		if (!projects) return { data: [], error: "No projects found!" };
		return { data: projects, error: "" };
	} catch (e: any) {
		return { error: getErrorMessage(e), data: [] };
	}
}

export async function getUserProject(projectID: string): Promise<{ data: FetchedProject | null; error: string }> {
	const user = await getCurrentUser();
	if (!user || !user.id) return { data: null, error: "Not logged in!" };
	try {
		const project = await prisma?.project.findUnique({ where: { owner_id_project_id: { owner_id: user.id, project_id: projectID } }, include: ProjectInclude });
		if (!project) return { data: null, error: "Project not found!" };
		return { data: project, error: "" };
	} catch (e: any) {
		return { error: getErrorMessage(e), data: null };
	}
}

export const GoalInclude = {
	tasks: {
		include: TaskInclude
	}
};

export const ProjectInclude = {
	goals: {
		include: GoalInclude
	},
	owner: {
		select: { image: true, name: true, id: true }
	}
};

export async function getProject(projectID: string, session: Session): Promise<{ data: FetchedProject | null; error: string }> {
	if (!session?.user?.id) return { data: null, error: "You must be signed in to get a project." };
	if (!projectID || projectID.length <= 0) return { data: null, error: "You must declare a valid project_id." };
	try {
		const project =
			(await prisma?.project.findUnique({
				where: {
					owner_id_project_id: {
						owner_id: session?.user?.id,
						project_id: projectID
					}
				},
				include: ProjectInclude
			})) ?? null;
		if (!project) return { data: null, error: "Project not found!" };
		return { data: project as FetchedProject, error: "" };
	} catch (e: any) {
		return { error: getErrorMessage(e), data: null };
	}
}

// project history

export async function getProjectHistory(project_id: string, session: Session): Promise<{ data: Action[]; error: string }> {
	if (!session?.user?.id) return { data: [], error: "You must be signed in to get project history." };
	if (!project_id || project_id.length <= 0) return { data: [], error: "You must declare a valid project_id." };
	return await getHistory(session?.user?.id, { path: ["project_id"], equals: project_id });
}
