import { Prisma, ProjectGoal, PROJECT_STATUS, Task, TaskModule, TaskTags, TASK_PROGRESS, TASK_VISIBILITY, TemplateTask } from "@prisma/client";
import { z } from "zod";

export type PageLink = {
	title: string;
	destination: string;
	colour?: string;
};

export enum Module {
	SUMMARY = "summary",
	CHECKLIST = "checklist",
	START_DATE = "start_date",
	END_DATE = "end_date",
	PRIORITY = "priority",
	DESCRIPTION = "description",
}

export enum TaskPriority {
	LOW = "LOW",
	MEDIUM = "MEDIUM",
	HIGH = "HIGH",
	URGENT = "URGENT",
}

export type ProjectRouteLink = {
    text: string;
    href: string;
}

export type CreateProjectType = {
	name: string;
	project_id: string;
	description: string;
	icon_url: string;
	link_text: string;
	link_url: string;
	repo_url: string;
	status: PROJECT_STATUS;
};

export type FetchedGoal = ProjectGoal & { tasks: FetchedTask[] };

// type CreateModuleOptions = {
// 	type: Module;
// 	data: any;
// }

export const createModuleInput = z.object({
	type: z.nativeEnum(Module),
	data: z.any()
})

export type CreateModuleOptions = z.infer<typeof createModuleInput>

// export type CreateItemOptions = {
// 	title: string;
// 	visibility?: TASK_VISIBILITY;
// 	progress?: TASK_PROGRESS;
// 	goal_id?: string;
// 	modules: CreateModuleOptions[]
// };

export const createItemInput = z.object({
	title: z.string(),
	visibility: z.nativeEnum(TASK_VISIBILITY).default(TASK_VISIBILITY.PRIVATE).optional(),
	progress: z.nativeEnum(TASK_PROGRESS).default(TASK_PROGRESS.UNSTARTED).optional(),
	goal_id: z.string().optional(),
	modules: z.array(createModuleInput)
});

export type CreateItemOptions = z.infer<typeof createItemInput>;

export const TaskInclude = {
	tags: true,
	templates: true,
	modules: true,
	parent: true,
	children: true
};

export type FetchedTask = Task & {
	tags: TaskTags[];
	templates: TemplateTask[];
	modules: TaskModule[];
	parent: Task;
	children: Task[];
};

export const getTaskModule = (task: FetchedTask, module_type: Module) => {
	return task.modules?.find((module) => module.type === module_type);
};

export const getModuleData = (task: FetchedTask, module_type: Module) => {
	const module = getTaskModule(task, module_type);
	if (!module) return null;
	return module.data as any;
};

export type LoadingStatus = {
	loading: boolean;
	error: string;
};

export type LoadedTask = FetchedTask & { network_status?: LoadingStatus };