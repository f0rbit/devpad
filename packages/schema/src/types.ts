import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import type { z } from "zod";
import type { action, api_key, codebase_tasks, goal, ignore_path, milestone, project, session, tag, tag_config, task, task_tag, todo_updates, tracker_result, user } from "./database/schema.js";
import type { config_schema, project_config, save_config_request, save_tags_request, update_action, update_user, upsert_goal, upsert_milestone, upsert_project, upsert_tag, upsert_todo } from "./validation.js";

// Database table select types (inferred from Drizzle schema)
export type User = InferSelectModel<typeof user>;
export type Session = InferSelectModel<typeof session>;
export type ApiKey = InferSelectModel<typeof api_key>;
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

// Database table insert types (inferred from Drizzle schema)
export type InsertUser = InferInsertModel<typeof user>;
export type InsertSession = InferInsertModel<typeof session>;
export type InsertApiKey = InferInsertModel<typeof api_key>;
export type InsertProject = InferInsertModel<typeof project>;
export type InsertTask = InferInsertModel<typeof task>;
export type InsertTag = InferInsertModel<typeof tag>;
export type InsertMilestone = InferInsertModel<typeof milestone>;
export type InsertGoal = InferInsertModel<typeof goal>;
export type InsertTaskTag = InferInsertModel<typeof task_tag>;
export type InsertAction = InferInsertModel<typeof action>;
export type InsertCodebaseTask = InferInsertModel<typeof codebase_tasks>;
export type InsertTodoUpdate = InferInsertModel<typeof todo_updates>;
export type InsertTrackerResult = InferInsertModel<typeof tracker_result>;
export type InsertTagConfig = InferInsertModel<typeof tag_config>;
export type InsertIgnorePath = InferInsertModel<typeof ignore_path>;

// Validation schema types (inferred from Zod schemas)
export type UpsertProject = z.infer<typeof upsert_project>;
export type UpsertTodo = z.infer<typeof upsert_todo>;
export type UpsertTag = z.infer<typeof upsert_tag>;
export type UpsertMilestone = z.infer<typeof upsert_milestone>;
export type UpsertGoal = z.infer<typeof upsert_goal>;
export type UpdateAction = z.infer<typeof update_action>;
export type ProjectConfig = z.infer<typeof project_config>;
export type SaveConfigRequest = z.infer<typeof save_config_request>;
export type SaveTagsRequest = z.infer<typeof save_tags_request>;

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

// API client interfaces
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

// Utility types
export type Nullable<T> = {
	[P in keyof T]: T[P] | null;
};

export type TaskView = "list" | "grid";
export type ScanStatus = "PENDING" | "ACCEPTED" | "REJECTED" | "IGNORED";

// History action type
export type HistoryAction = Omit<Action, "updated_at" | "owner_id" | "type"> & {
	type: string | "SCAN"; // TODO: Import ActionType from database schema
};

// API response types
export interface ApiResponse<T> {
	success: boolean;
	data?: T;
	error?: string;
}

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

export interface BufferedQueue<T> {
	latest(): T | null;
	list(): T[];
	add(item: T): void;
	size(): number;
	clear(): void;
}

export class ArrayBufferedQueue<T> implements BufferedQueue<T> {
	private _entries: T[] = [];
	private _head: number = 0;
	private _tail: number = 0;
	private _size: number = 0;

	constructor(private _capacity: number) {}

	latest(): T | null {
		if (this._size === 0) return null;
		return this._entries[this._tail - 1] ?? null;
	}

	list(): T[] {
		if (this._size === 0) return [];
		if (this._head < this._tail) {
			return this._entries.slice(this._head, this._tail);
		}
		return this._entries.slice(this._head).concat(this._entries.slice(0, this._tail));
	}

	add(item: T): void {
		if (this._size === this._capacity) {
			this._head = (this._head + 1) % this._capacity;
		} else {
			this._size++;
		}
		this._entries[this._tail] = item;
		this._tail = (this._tail + 1) % this._capacity;
	}

	size(): number {
		return this._size;
	}

	clear(): void {
		this._entries = [];
		this._head = 0;
		this._tail = 0;
		this._size = 0;
	}
}
