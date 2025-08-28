import { z } from "zod";

// API Request/Response schemas
export const ProjectCreateSchema = z.object({
	name: z.string(),
	description: z.string().optional(),
	specification: z.string().optional(),
	repo_url: z.string().optional(),
	icon_url: z.string().optional(),
	visibility: z.enum(["public", "private"]).optional(),
});

export const ProjectUpdateSchema = z.object({
	project_id: z.string(),
	name: z.string().optional(),
	description: z.string().nullable().optional(),
	specification: z.string().nullable().optional(), 
	repo_url: z.string().nullable().optional(),
	icon_url: z.string().nullable().optional(),
	visibility: z.enum(["public", "private"]).nullable().optional(),
	archived: z.boolean().optional(),
});

export const ProjectUpsertSchema = ProjectCreateSchema.merge(
	ProjectUpdateSchema.omit({ project_id: true }).extend({
		project_id: z.string().optional(),
	})
);

export const TaskCreateSchema = z.object({
	project_id: z.string(),
	title: z.string(),
	description: z.string().optional(),
	status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional(),
	priority: z.enum(["low", "medium", "high"]).optional(),
	tags: z.array(z.string()).optional(),
});

export const TaskUpdateSchema = z.object({
	task_id: z.string(),
	project_id: z.string().optional(),
	title: z.string().optional(),
	description: z.string().nullable().optional(),
	status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional(),
	priority: z.enum(["low", "medium", "high"]).optional(),
	tags: z.array(z.string()).optional(),
});

export const TaskUpsertSchema = TaskCreateSchema.merge(
	TaskUpdateSchema.omit({ task_id: true }).extend({
		task_id: z.string().optional(),
	})
);

export const TagCreateSchema = z.object({
	title: z.string(),
	color: z.enum(["red", "green", "blue", "yellow", "purple", "orange", "teal", "pink", "gray", "cyan", "lime"]).nullable().optional(),
});

// API Response types
export const ApiResponseSchema = z.object({
	success: z.boolean(),
	message: z.string().optional(),
	data: z.unknown().optional(),
	error: z.string().optional(),
});

// Exported types for client usage
export type ProjectCreate = z.infer<typeof ProjectCreateSchema>;
export type ProjectUpdate = z.infer<typeof ProjectUpdateSchema>;
export type ProjectUpsert = z.infer<typeof ProjectUpsertSchema>;

export type TaskCreate = z.infer<typeof TaskCreateSchema>;
export type TaskUpdate = z.infer<typeof TaskUpdateSchema>;
export type TaskUpsert = z.infer<typeof TaskUpsertSchema>;

export type TagCreate = z.infer<typeof TagCreateSchema>;

export type ApiResponse<T = unknown> = z.infer<typeof ApiResponseSchema> & {
	data?: T;
};