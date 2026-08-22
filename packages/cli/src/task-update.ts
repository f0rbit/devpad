import { type TaskProgress, task_status_to_progress } from "./task-progress";

export type TaskUpdateOptions = {
	status?: string;
	title?: string;
	summary?: string;
	priority?: string;
};

export type TaskUpdateInput = {
	id: string;
	title?: string;
	summary?: string;
	priority?: string;
	progress?: TaskProgress;
};

export function build_task_update_input(id: string, options: TaskUpdateOptions): TaskUpdateInput | null {
	if (!options.status && !options.title && !options.summary && !options.priority) return null;

	return {
		id,
		title: options.title,
		summary: options.summary,
		priority: options.priority ? options.priority.toUpperCase() : undefined,
		progress: task_status_to_progress(options.status),
	};
}
