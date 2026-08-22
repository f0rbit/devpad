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
	progress?: "TODO" | "IN_PROGRESS" | "DONE";
};

const task_status_to_progress = (status?: string): TaskUpdateInput["progress"] => {
	if (status === "done") return "DONE";
	if (status === "in_progress") return "IN_PROGRESS";
	if (status === "todo") return "TODO";
	return undefined;
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
