import type { HistoryAction } from "@devpad/schema";
import type { ActionType } from "@devpad/schema/database";
import { action, todo_updates } from "@devpad/schema/database/schema";
import { err, ok, type Result } from "@f0rbit/corpus";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { ServiceError } from "./errors.js";
import { getProjectById, getUserProjectMap } from "./projects.js";
import { getTask } from "./tasks.js";

export async function getActions(db: any, user_id: string, action_filter: ActionType[] | null): Promise<Result<any[], ServiceError>> {
	const filter = action_filter && action_filter.length > 0 ? action_filter : null;

	const data = filter
		? await db
				.select()
				.from(action)
				.where(and(eq(action.owner_id, user_id), inArray(action.type, filter)))
		: await db.select().from(action).where(eq(action.owner_id, user_id));

	const project_map_result = await getUserProjectMap(db, user_id);
	if (!project_map_result.ok) return project_map_result;
	const project_map = project_map_result.value;

	for (const a of data) {
		const action_data = a.data as any;
		const p = project_map[action_data.project_id];
		if (p) {
			action_data.href = p.project_id;
			action_data.name = p.name;
		}
	}

	return ok(data);
}

export async function getProjectScanHistory(db: any, project_id: string): Promise<Result<any[], ServiceError>> {
	const result = await db.select().from(todo_updates).where(eq(todo_updates.project_id, project_id)).orderBy(desc(todo_updates.created_at));
	return ok(result);
}

function sortByDate(a: HistoryAction, b: HistoryAction) {
	return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
}

export async function getProjectHistory(db: any, project_id: string): Promise<Result<HistoryAction[], ServiceError>> {
	const project_filter: ActionType[] = ["CREATE_PROJECT", "UPDATE_PROJECT", "DELETE_PROJECT", "CREATE_TASK", "UPDATE_TASK", "DELETE_TASK"];

	const project_result = await getProjectById(db, project_id);
	if (!project_result.ok) return ok([]);
	const user_id = project_result.value.owner_id;

	const actions_result = await getActions(db, user_id, project_filter);
	if (!actions_result.ok) return actions_result;

	const filtered: HistoryAction[] = actions_result.value.filter((a: any) => {
		const data = a.data as any;
		return data.project_id === project_id;
	});

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

export async function getTaskHistory(db: any, task_id: string): Promise<Result<HistoryAction[], ServiceError>> {
	const task_filter: ActionType[] = ["CREATE_TASK", "UPDATE_TASK", "DELETE_TASK"];

	const task_result = await getTask(db, task_id);
	if (!task_result.ok) return ok([]);
	if (!task_result.value) return ok([]);

	const user_id = task_result.value.task.owner_id;

	const actions_result = await getActions(db, user_id, task_filter);
	if (!actions_result.ok) return actions_result;

	const filtered: HistoryAction[] = actions_result.value.filter((a: any) => {
		const data = a.data as any;
		return data.task_id === task_id;
	});

	return ok(filtered.sort(sortByDate));
}

export async function getUserHistory(db: any, user_id: string): Promise<Result<HistoryAction[], ServiceError>> {
	const project_filter: ActionType[] = ["CREATE_PROJECT", "UPDATE_PROJECT", "DELETE_PROJECT"];

	const actions_result = await getActions(db, user_id, project_filter);
	if (!actions_result.ok) return actions_result;

	return ok((actions_result.value as HistoryAction[]).sort(sortByDate));
}
