import { z } from "zod";
import { ProjectType, TaskType, TagType } from "../schemas/database";
import { 
	ProjectCreateSchema,
	ProjectUpdateSchema,
	ProjectUpsertSchema,
	TaskCreateSchema,
	TaskUpdateSchema,
	TaskUpsertSchema,
	TagCreateSchema,
	ApiResponse as ApiResponseType
} from "../schemas/api";

export interface ApiClientConfig {
	baseUrl: string;
	apiKey: string;
}

export interface RequestOptions {
	method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
	headers?: Record<string, string>;
	body?: object;
	query?: Record<string, string>;
}

// Re-export database types
export type { ProjectType, TaskType, TagType };

// Re-export API response type
export type ApiResponse<T = unknown> = ApiResponseType<T>;

// Make the schemas more user-friendly with Partial wrappers where appropriate
export type ProjectCreate = Partial<z.infer<typeof ProjectCreateSchema>>;
export type ProjectUpdate = Partial<z.infer<typeof ProjectUpdateSchema>>;
export type ProjectUpsert = Partial<z.infer<typeof ProjectUpsertSchema>>;

export type TaskCreate = Partial<z.infer<typeof TaskCreateSchema>>;
export type TaskUpdate = Partial<z.infer<typeof TaskUpdateSchema>>;
export type TaskUpsert = Partial<z.infer<typeof TaskUpsertSchema>>;

export type TagCreate = Partial<z.infer<typeof TagCreateSchema>>;

// Legacy aliases for backward compatibility
export type UpsertProject = ProjectUpsert;
export type UpsertTask = TaskUpsert;
export type UpsertTag = TagCreate;

export type SelectProject = ProjectType;
export type SelectTask = TaskType;