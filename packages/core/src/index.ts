// Main exports for @devpad/core package

// Re-export types from schema for convenience
export type {
	HistoryAction,
	Project,
	ProjectWithTasks,
	ScanStatus,
	Tag,
	TagWithColor,
	Task,
	TaskView,
	TaskWithDetails,
	UpdateAction,
	UpdateData,
	UpsertProject,
	UpsertTag,
	UpsertTodo,
	User,
} from "@devpad/schema";
export * from "./auth/index.js";
export * from "./auth/jwt.js";
export * from "./services/index.js";
