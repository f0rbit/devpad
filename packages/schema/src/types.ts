import type { InferSelectModel } from "drizzle-orm";
import type { z } from "zod";
import type { ActionType, action, api_keys, codebase_tasks, goal, ignore_path, milestone, project, session, tag, tag_config, task, task_tag, todo_updates, tracker_result, user } from "./database/schema.js";
import type { config_schema, project_config, save_config_request, update_action, update_user, upsert_goal, upsert_milestone, upsert_project, upsert_tag, upsert_todo } from "./validation.js";

// Database table select types (inferred from Drizzle schema)
export type User = InferSelectModel<typeof user>;
export type Session = InferSelectModel<typeof session>;
export type ApiKey = InferSelectModel<typeof api_keys>;
export type Project = InferSelectModel<typeof project>;
export type Task = InferSelectModel<typeof task>;
export type Tag = InferSelectModel<typeof tag>;
export type Milestone = InferSelectModel<typeof milestone>;
export type Goal = InferSelectModel<typeof goal>;
export type TaskTag = InferSelectModel<typeof task_tag>;
export type Action = InferSelectModel<typeof action>;
export type CodebaseTask = InferSelectModel<typeof codebase_tasks>;
export type TodoUpdate = InferSelectModel<typeof todo_updates>;
export type TrackerResult = InferSelectModel<typeof tracker_result>;
export type TagConfig = InferSelectModel<typeof tag_config>;
export type IgnorePath = InferSelectModel<typeof ignore_path>;

// Validation schema types (inferred from Zod schemas)
export type UpsertProject = z.infer<typeof upsert_project>;
export type UpsertTodo = z.infer<typeof upsert_todo>;
export type UpsertTag = z.infer<typeof upsert_tag>;
export type UpsertMilestone = z.infer<typeof upsert_milestone>;
export type UpsertGoal = z.infer<typeof upsert_goal>;
export type UpdateAction = z.infer<typeof update_action>;
export type ProjectConfig = z.infer<typeof project_config>;
export type SaveConfigRequest = z.infer<typeof save_config_request>;

// Utility/combination types for API responses and complex data structures
export interface TaskWithDetails {
	task: Task;
	codebase_tasks: CodebaseTask | null;
	tags: string[];
}

export interface ProjectWithTasks {
	project: Project;
	tasks: TaskWithDetails[];
}

export interface TagWithColor {
	id: string;
	title: string;
	color: string | null;
	count?: number;
}

export type GetConfigResult = { config: ProjectConfig; scan_branch: string };

// Tag color constants (moved from validation.ts)
export const TAG_COLOURS = {
	red: { colour: "#F28B82", text: "#faeeef", border: "#F5A5A5" },
	green: { colour: "#CCFF90", text: "#2E7D32", border: "#A5D6A7" },
	blue: { colour: "#82B1FF", text: "#0D47A1", border: "#90CAF9" },
	yellow: { colour: "#FFF176", text: "#F57F17", border: "#FFF59D" },
	purple: { colour: "#E1BEE7", text: "#4A148C", border: "#CE93D8" },
	orange: { colour: "#FFCC80", text: "#E65100", border: "#FFB74D" },
	teal: { colour: "#80CBC4", text: "#004D40", border: "#4DB6AC" },
	pink: { colour: "#F8BBD9", text: "#880E4F", border: "#F48FB1" },
	gray: { colour: "#CFD8DC", text: "#37474F", border: "#B0BEC5" },
	cyan: { colour: "#84FFFF", text: "#006064", border: "#4DD0E1" },
	lime: { colour: "#ddf0bc", text: "#88b47f", border: "#becca5" },
} as const;

export type TagColor = keyof typeof TAG_COLOURS;

// Enhanced Tag type with color
type _FetchedTag = InferSelectModel<typeof tag>;
export type TagWithTypedColor = Omit<_FetchedTag, "color"> & { color: TagColor | null };

// Utility types
export type Nullable<T> = {
	[P in keyof T]: T[P] | null;
};

export type TaskView = "list" | "grid";
export type ScanStatus = "PENDING" | "ACCEPTED" | "REJECTED" | "IGNORED";

// History action type
export type HistoryAction = Omit<Action, "updated_at" | "owner_id" | "type"> & {
	type: ActionType | "SCAN";
};

// Update data type for project scanning
export interface UpdateData {
	id: string;
	tag: string;
	type: "SAME" | "UPDATE" | "DELETE" | "NEW" | "MOVE";
	data: {
		old: {
			text: string;
			line: number;
			file: string;
			context?: string[];
		};
		new: {
			text: string;
			line: number;
			file: string;
			context?: string[];
		};
	};
	task?: TaskWithDetails;
}

export type UpdateUser = z.infer<typeof update_user>;
export type ConfigSchemaType = z.infer<typeof config_schema>;
