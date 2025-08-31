// Main exports for @devpad/core package
export * from './services/index.js';
export * from './auth/index.js';

// Re-export types from schema for convenience
export type {
	Project,
	Task,
	Tag,
	User,
	UpsertProject,
	UpsertTodo,
	UpsertTag,
	UpdateData,
	TaskWithDetails,
	ProjectWithTasks,
	TagWithColor,
	UpdateAction,
	ScanStatus,
	TaskView,
	HistoryAction
} from '@devpad/schema';