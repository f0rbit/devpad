// Main exports for @devpad/core package

// Re-export types from schema for convenience
export type {
	Goal,
	HistoryAction,
	Milestone,
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
	UpsertGoal,
	UpsertMilestone,
	UpsertProject,
	UpsertTag,
	UpsertTodo,
	User,
} from "@devpad/schema";
export * from "./auth/index.js";
export * from "./services/index.js";
export * from "./utils/context-parser.js";
