import { ProjectGoal, PROJECT_STATUS, Task, TASK_PROGRESS, TASK_VISIBILITY } from "@prisma/client";
import { FetchedTask } from "src/utils/trpc";

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
	LOW,
	MEDIUM,
	HIGH,
	URGENT,
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

export type CreateItemOptions = {
	title: string;
	summary: string;
	due_date: Date | null;
	visibility?: TASK_VISIBILITY;
	progress?: TASK_PROGRESS;
	goal_id?: string;
};