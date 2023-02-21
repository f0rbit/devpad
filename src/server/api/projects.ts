import { CreateProjectType, FetchedGoal, FetchedProject, TaskInclude } from "@/types/page-link";
import { Action, ACTION_TYPE, Project, Prisma, ProjectGoal, Task } from "@prisma/client";
import { Session } from "next-auth";
import { getErrorMessage } from "src/utils/backend";
import { getCurrentUser } from "src/utils/session";
import { createAction, getHistory } from "./action";

export async function createProject(project: CreateProjectType, session: Session): Promise<{ data: string | null; error: string | null }> {
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

export async function getUserProjects({ includeDeleted }: { includeDeleted?: boolean }): Promise<{ data: Project[]; error: string }> {
	const user = await getCurrentUser();
	if (!user || !user.id) return { data: [], error: "Not logged in!" };
	try {
		const deleted = includeDeleted ? undefined : false;
		const projects = await prisma?.project.findMany({ where: { owner_id: user.id, deleted } });
		if (!projects) return { data: [], error: "No projects found!" };
		return { data: projects, error: "" };
	} catch (e: any) {
		return { error: getErrorMessage(e), data: [] };
	}
}

export async function getUserProject(projectID: string): Promise<{ data: Project | null; error: string }> {
	const user = await getCurrentUser();
	if (!user || !user.id) return { data: null, error: "Not logged in!" };
	try {
		const project = await prisma?.project.findUnique({ where: { owner_id_project_id: { owner_id: user.id, project_id: projectID } } });
		if (!project) return { data: null, error: "Project not found!" };
		return { data: project, error: "" };
	} catch (e: any) {
		return { error: getErrorMessage(e), data: null };
	}
}


const GoalInclude = {
	tasks: {
		include: TaskInclude
	}
}

const ProjectInclude = {
	goals: {
		include: GoalInclude
	}
}

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
