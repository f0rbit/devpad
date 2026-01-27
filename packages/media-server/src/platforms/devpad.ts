import { tasksD1 } from "@devpad/core/services";
import { createD1Database } from "@devpad/schema/database/d1";
import type { DevpadRaw, DevpadTask, TaskPayload, TimelineItem } from "@devpad/schema/media";
import { err, ok } from "../utils";
import { BaseMemoryProvider } from "./memory-base";
import type { FetchResult, Provider } from "./types";

const mapProgress = (progress: string): "todo" | "in_progress" | "done" | "archived" => {
	switch (progress) {
		case "IN_PROGRESS":
			return "in_progress";
		case "COMPLETED":
			return "done";
		default:
			return "todo";
	}
};

const mapPriority = (priority: string): "low" | "medium" | "high" => {
	switch (priority) {
		case "HIGH":
			return "high";
		case "MEDIUM":
			return "medium";
		default:
			return "low";
	}
};

const mapTaskToDevpadTask = (t: any): DevpadTask => ({
	id: t.task.id,
	title: t.task.title,
	status: t.task.visibility === "ARCHIVED" ? "archived" : mapProgress(t.task.progress),
	priority: mapPriority(t.task.priority),
	project: t.task.project_id ?? undefined,
	tags: t.tags ?? [],
	created_at: t.task.created_at,
	updated_at: t.task.updated_at,
	due_date: undefined,
	completed_at: t.task.end_time ?? undefined,
});

export class DevpadProvider implements Provider<DevpadRaw> {
	readonly platform = "devpad";
	private d1: D1Database;
	private user_id: string;

	constructor(d1: D1Database, user_id: string) {
		this.d1 = d1;
		this.user_id = user_id;
	}

	async fetch(_token: string): Promise<FetchResult<DevpadRaw>> {
		const db = createD1Database(this.d1);
		const result = await tasksD1.getUserTasks(db, this.user_id);
		if (!result.ok) return err({ kind: "api_error", status: 500, message: result.error.kind });
		const tasks = result.value.map(mapTaskToDevpadTask);
		return ok({ tasks, fetched_at: new Date().toISOString() });
	}
}

const makeTaskId = (id: string): string => `devpad:task:${id}`;
const makeTaskUrl = (id: string): string => `https://devpad.tools/tasks/${id}`;

export const normalizeDevpad = (raw: DevpadRaw): TimelineItem[] =>
	raw.tasks.map((task): TimelineItem => {
		const payload: TaskPayload = {
			type: "task",
			status: task.status,
			priority: task.priority,
			project: task.project,
			tags: task.tags,
			due_date: task.due_date,
			completed_at: task.completed_at,
		};
		return {
			id: makeTaskId(task.id),
			platform: "devpad",
			type: "task",
			timestamp: task.updated_at,
			title: task.title,
			url: makeTaskUrl(task.id),
			payload,
		};
	});

export type DevpadMemoryConfig = {
	tasks?: DevpadTask[];
};

export class DevpadMemoryProvider extends BaseMemoryProvider<DevpadRaw> implements Provider<DevpadRaw> {
	readonly platform = "devpad";
	private config: DevpadMemoryConfig;

	constructor(config: DevpadMemoryConfig = {}) {
		super();
		this.config = config;
	}

	protected getData(): DevpadRaw {
		return {
			tasks: this.config.tasks ?? [],
			fetched_at: new Date().toISOString(),
		};
	}

	setTasks(tasks: DevpadTask[]): void {
		this.config.tasks = tasks;
	}
}
