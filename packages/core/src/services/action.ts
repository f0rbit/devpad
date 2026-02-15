import type { Action, HistoryAction } from "@devpad/schema";
import type { ActionType } from "@devpad/schema/database";
import { action, todo_updates } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { err, ok, type Result } from "@f0rbit/corpus";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import type { ServiceError } from "./errors.js";
import { getProjectById, getUserProjectMap } from "./projects.js";
import { getTask } from "./tasks.js";

type ActionData = {
	task_id?: string;
	project_id?: string;
	title?: string;
	href?: string;
	name?: string;
	message?: string;
	status?: string;
};

type ActionWithData = Omit<Action, "data"> & { data: ActionData };

export async function getActions(db: Database, user_id: string, action_filter: ActionType[] | null): Promise<Result<ActionWithData[], ServiceError>> {
	const filter = action_filter && action_filter.length > 0 ? action_filter : null;

	const raw_data = filter
		? await db
				.select()
				.from(action)
				.where(and(eq(action.owner_id, user_id), inArray(action.type, filter)))
		: await db.select().from(action).where(eq(action.owner_id, user_id));

	const project_map_result = await getUserProjectMap(db, user_id);
	if (!project_map_result.ok) return project_map_result;
	const project_map = project_map_result.value;

	const data: ActionWithData[] = raw_data.map(a => {
		const action_data = (a.data ?? {}) as ActionData;
		const p = action_data.project_id ? project_map[action_data.project_id] : undefined;
		if (p) {
			action_data.href = p.project_id;
			action_data.name = p.name;
		}
		return { ...a, data: action_data };
	});

	return ok(data);
}

export async function getProjectScanHistory(db: Database, project_id: string): Promise<Result<any[], ServiceError>> {
	const result = await db.select().from(todo_updates).where(eq(todo_updates.project_id, project_id)).orderBy(desc(todo_updates.created_at));
	return ok(result);
}

function sortByDate(a: HistoryAction, b: HistoryAction) {
	return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
}

export async function getProjectHistory(db: Database, project_id: string): Promise<Result<HistoryAction[], ServiceError>> {
	const project_filter: ActionType[] = ["CREATE_PROJECT", "UPDATE_PROJECT", "DELETE_PROJECT", "CREATE_TASK", "UPDATE_TASK", "DELETE_TASK"];

	const project_result = await getProjectById(db, project_id);
	if (!project_result.ok) return ok([]);
	const user_id = project_result.value.owner_id;

	const actions_result = await getActions(db, user_id, project_filter);
	if (!actions_result.ok) return actions_result;

	const filtered: HistoryAction[] = actions_result.value.filter(a => a.data.project_id === project_id);

	const scan_result = await getProjectScanHistory(db, project_id);
	if (!scan_result.ok) return scan_result;

	const mapped_scan: HistoryAction[] = scan_result.value.map((s: any) => ({
		id: `scan-${s.id}`,
		type: "SCAN",
		description: `Scanned branch '${s.branch}'`,
		created_at: s.created_at,
		deleted: false,
		data: { project_id, message: s.commit_msg, status: s.status },
	}));

	return ok(filtered.concat(mapped_scan).sort(sortByDate));
}

export async function getTaskHistory(db: Database, task_id: string): Promise<Result<HistoryAction[], ServiceError>> {
	const task_filter: ActionType[] = ["CREATE_TASK", "UPDATE_TASK", "DELETE_TASK"];

	const task_result = await getTask(db, task_id);
	if (!task_result.ok) return ok([]);
	if (!task_result.value) return ok([]);

	const user_id = task_result.value.task.owner_id;

	const actions_result = await getActions(db, user_id, task_filter);
	if (!actions_result.ok) return actions_result;

	const filtered: HistoryAction[] = actions_result.value.filter(a => a.data.task_id === task_id);

	return ok(filtered.sort(sortByDate));
}

export async function getUserHistory(db: Database, user_id: string): Promise<Result<HistoryAction[], ServiceError>> {
	const project_filter: ActionType[] = ["CREATE_PROJECT", "UPDATE_PROJECT", "DELETE_PROJECT"];

	const actions_result = await getActions(db, user_id, project_filter);
	if (!actions_result.ok) return actions_result;

	return ok((actions_result.value as HistoryAction[]).sort(sortByDate));
}

export type AISession = {
	started_at: string;
	ended_at: string;
	action_count: number;
	actions: ActionWithData[];
	entities_touched: string[];
	summary: string;
};

export async function getAIActivity(db: Database, user_id: string, options?: { limit?: number; since?: string }): Promise<Result<AISession[], ServiceError>> {
	const conditions = [eq(action.owner_id, user_id), eq(action.channel, "api")];
	if (options?.since) {
		conditions.push(gt(action.created_at, options.since));
	}

	const raw_data = await db
		.select()
		.from(action)
		.where(and(...conditions))
		.orderBy(desc(action.created_at));

	const project_map_result = await getUserProjectMap(db, user_id);
	if (!project_map_result.ok) return project_map_result;
	const project_map = project_map_result.value;

	const actions: ActionWithData[] = raw_data.map(a => {
		const action_data = (a.data ?? {}) as ActionData;
		const p = action_data.project_id ? project_map[action_data.project_id] : undefined;
		if (p) {
			action_data.href = p.project_id;
			action_data.name = p.name;
		}
		return { ...a, data: action_data };
	});

	const SESSION_GAP_MS = 10 * 60 * 1000;
	const sessions: AISession[] = [];
	let current_session: ActionWithData[] = [];

	for (const a of actions) {
		if (current_session.length === 0) {
			current_session.push(a);
			continue;
		}

		const prev_time = new Date(current_session[current_session.length - 1].created_at).getTime();
		const curr_time = new Date(a.created_at).getTime();

		if (Math.abs(prev_time - curr_time) <= SESSION_GAP_MS) {
			current_session.push(a);
		} else {
			sessions.push(buildSession(current_session));
			current_session = [a];
		}
	}

	if (current_session.length > 0) {
		sessions.push(buildSession(current_session));
	}

	const limit = options?.limit ?? 20;
	return ok(sessions.slice(0, limit));
}

function buildSession(actions: ActionWithData[]): AISession {
	const sorted = [...actions].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
	const started_at = sorted[0].created_at;
	const ended_at = sorted[sorted.length - 1].created_at;

	const entity_ids = new Set<string>();
	const type_counts: Record<string, number> = {};

	for (const a of actions) {
		const data = a.data;
		if (data.task_id) entity_ids.add(data.task_id);
		if (data.project_id) entity_ids.add(data.project_id);

		const base_type = a.type.replace(/^(CREATE|UPDATE|DELETE)_/, "").toLowerCase();
		const verb = a.type.startsWith("CREATE") ? "Created" : a.type.startsWith("UPDATE") ? "Updated" : "Deleted";
		const key = `${verb} ${base_type}`;
		type_counts[key] = (type_counts[key] ?? 0) + 1;
	}

	const summary = Object.entries(type_counts)
		.map(([key, count]) => `${key}${count > 1 ? "s" : ""}: ${count}`)
		.join(", ");

	return {
		started_at,
		ended_at,
		action_count: actions.length,
		actions: sorted,
		entities_touched: Array.from(entity_ids),
		summary,
	};
}
