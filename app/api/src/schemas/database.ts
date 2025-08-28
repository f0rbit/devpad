import { z } from "zod";

// Database table types for API package
export const SelectProject = z.object({
	id: z.string(),
	project_id: z.string(), 
	owner_id: z.string(),
	name: z.string(),
	description: z.string().nullable(),
	specification: z.string().nullable(),
	repo_url: z.string().nullable(),
	repo_id: z.number().nullable(),
	icon_url: z.string().nullable(),
	created_at: z.string(),
	updated_at: z.string().nullable(),
	archived: z.boolean(),
	visibility: z.enum(["public", "private"]).nullable(),
	scan_complete: z.boolean(),
});

export const SelectTask = z.object({
	id: z.string(),
	task_id: z.string(),
	project_id: z.string(),
	owner_id: z.string(), 
	title: z.string(),
	description: z.string().nullable(),
	status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
	priority: z.enum(["low", "medium", "high"]),
	created_at: z.string(),
	updated_at: z.string().nullable(),
	github_issue_id: z.number().nullable(),
});

export const SelectTag = z.object({
	id: z.string(),
	owner_id: z.string(),
	title: z.string(),
	color: z.enum(["red", "green", "blue", "yellow", "purple", "orange", "teal", "pink", "gray", "cyan", "lime"]).nullable(),
	deleted: z.boolean(),
	render: z.boolean(),
	created_at: z.string(),
});

export const SelectTaskTag = z.object({
	task_id: z.string(),
	tag_id: z.string(),
});

export type ProjectType = z.infer<typeof SelectProject>;
export type TaskType = z.infer<typeof SelectTask>;
export type TagType = z.infer<typeof SelectTag>;
export type TaskTagType = z.infer<typeof SelectTaskTag>;