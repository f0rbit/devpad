import { UpdateProject } from "@/server/api/projects";
import { Context } from "@/server/trpc/context";
import { FetchedProject, FetchedTask, LoadedTask, Module, TaskPriority } from "@/types/page-link";
import { ProjectGoal, TASK_PROGRESS } from "@prisma/client";

export const contextUserOwnsTag = async (ctx: Context, tagID: string) => {
	if (!ctx.prisma) return false;
	const tag = await ctx.prisma.taskTags.findFirst({
		where: {
			id: tagID
		}
	});
	return tag?.owner_id == ctx.session?.user?.id;
};

export const contextUserOwnsTask = async (ctx: Context, taskID: string) => {
	if (!ctx.prisma) return false;
	const task = await ctx.prisma.task.findFirst({
		where: {
			id: taskID
		}
	});
	return task?.owner_id == ctx.session?.user?.id;
};

export const getDefaultModuleData = (module: Module) => {
	switch (module) {
		case Module.END_DATE:
		case Module.START_DATE:
			return {
				date: new Date().toISOString()
			};
		case Module.PRIORITY:
			return {
				priority: TaskPriority.MEDIUM
			};
		case Module.CHECKLIST: {
			return {
				items: []
			};
		}
		case Module.SUMMARY: {
			return {
				summary: ""
			};
		}
		case Module.DESCRIPTION: {
			return {
				description: []
			};
		}
		default:
			return {};
	}
};

export function getErrorMessage(error: any) {
	var result = "Unknown error";
	if (typeof error === "string") {
		result = error.toUpperCase(); // works, `e` narrowed to string
	} else if (error instanceof Error) {
		result = error.message; // works, `e` narrowed to Error
	}
	return result;
}

/**
 * Returns the progress of a list of tasks, as a number between 0 and 1
 */
export function getTasksProgress(tasks: FetchedTask[]) {
	const total = tasks.length;
	return tasks.reduce((acc, task) => {
		return acc + getTaskProgress(task) / total;
	}, 0);
}

/**
 * Returns the progress as a number between 0 and 1,
 * where 0 is unstarted and 1 is completed
 */
export function getTaskProgress(task: FetchedTask) {
	/** @todo if the task has a checklist, then use that as progress */
	switch (task.progress) {
		case TASK_PROGRESS.COMPLETED:
			return 1;
		case TASK_PROGRESS.IN_PROGRESS:
			return 0.5;
		case TASK_PROGRESS.UNSTARTED:
			return 0;
		default:
			return 0;
	}
}

export function extractUpdateFieldsFromProject(project: FetchedProject): UpdateProject {
	return {
		project_id: project.project_id,
		current_version: project.current_version,
		deleted: project.deleted,
		description: project.description,
		icon_url: project.icon_url,
		link_text: project.link_text,
		link_url: project.link_url,
		name: project.name,
		repo_url: project.repo_url,
		status: project.status,
		specification: project.specification
	};
}
