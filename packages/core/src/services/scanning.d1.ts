import { type DiffResult, generateDiff, type ParsedTask, scanGitHubRepo } from "@devpad/scanner";
import type { TodoUpdate, TrackerResult, UpsertTodo } from "@devpad/schema";
import { action, codebase_tasks, project, task, todo_updates, tracker_result } from "@devpad/schema/database/schema";
import { err, ok, type Result } from "@f0rbit/corpus";
import { and, desc, eq } from "drizzle-orm";
import { parseContextToArray } from "../utils/context-parser.js";
import type { ServiceError } from "./errors.js";
import { getProjectConfig } from "./projects.d1.js";

export async function* initiateScan(db: any, project_id: string, user_id: string, access_token: string): AsyncGenerator<string> {
	yield "starting\n";

	const project_query = await db
		.select()
		.from(project)
		.where(and(eq(project.id, project_id), eq(project.owner_id, user_id)));

	if (project_query.length !== 1) {
		yield "error: project not found or access denied\n";
		return;
	}

	const project_data = project_query[0];

	if (!project_data.repo_url) {
		yield "error: project not linked to repository\n";
		return;
	}

	yield "loading config\n";
	const config_result = await getProjectConfig(db, project_id);
	if (!config_result.ok) {
		const config_err = config_result.error as ServiceError;
		yield `error: ${config_err.kind === "not_found" ? "project not found" : ((config_err as any).message ?? config_err.kind)}\n`;
		return;
	}

	const { config, scan_branch } = config_result.value;

	const slices = project_data.repo_url.split("/");
	const repo = slices.at(-1);
	const owner = slices.at(-2);

	if (!owner || !repo) {
		yield "error: could not parse repo url\n";
		return;
	}

	yield "scanning repo\n";
	const scan_config = {
		tags: config.tags ?? [],
		ignore: config.ignore ?? [],
	};

	const scan_result = await scanGitHubRepo(owner, repo, scan_branch || "main", access_token, scan_config);

	if (!scan_result.ok) {
		const scan_err = scan_result.error;
		const msg = scan_err.kind === "rate_limited" ? "rate limited" : scan_err.message;
		yield `error: scan failed - ${msg}\n`;
		return;
	}

	const parsed_tasks = scan_result.value;

	yield "saving scan\n";
	const new_tracker = await db
		.insert(tracker_result)
		.values({
			project_id,
			data: JSON.stringify(parsed_tasks),
		})
		.returning();

	if (new_tracker.length !== 1) {
		yield "error: failed to save scan results\n";
		return;
	}

	yield "finding existing scan\n";
	const new_id = new_tracker[0].id;
	const old_result = await db
		.select()
		.from(tracker_result)
		.where(and(eq(tracker_result.project_id, project_id), eq(tracker_result.accepted, true)))
		.orderBy(desc(tracker_result.created_at))
		.limit(1);

	let old_tasks: ParsedTask[] = [];
	if (old_result.length === 1) {
		const existing = await db.select().from(codebase_tasks).where(eq(codebase_tasks.recent_scan_id, old_result[0].id));

		old_tasks = existing.map((item: any) => ({
			id: item.id,
			file: item.file || "",
			line: item.line || 0,
			tag: item.type || "todo",
			text: item.text || "",
			context: parseContextToArray(item.context),
		}));
	}

	yield "running diff\n";
	const diff_results = generateDiff(old_tasks, parsed_tasks);

	yield "saving update\n";
	await db
		.update(todo_updates)
		.set({ status: "IGNORED" })
		.where(and(eq(todo_updates.project_id, project_id), eq(todo_updates.status, "PENDING")));

	await db.insert(todo_updates).values({
		project_id,
		new_id,
		old_id: old_result[0]?.id ?? null,
		data: JSON.stringify(diff_results),
	});

	yield "done\n";
}

function createCodebaseTaskValues(update_item: any, new_id: number): any {
	const new_text = update_item.data?.new?.text || "";
	return {
		id: update_item.id,
		text: new_text,
		line: update_item.data?.new?.line || 0,
		file: update_item.data?.new?.file || "unknown",
		type: update_item.tag || "todo",
		context: update_item.data?.new?.context ? JSON.stringify(update_item.data.new.context) : null,
		recent_scan_id: new_id,
		updated_at: new Date().toISOString(),
	};
}

async function upsertCodebaseTask(db: any, update_item: any, new_id: number): Promise<void> {
	const values = createCodebaseTaskValues(update_item, new_id);
	await db
		.insert(codebase_tasks)
		.values(values)
		.onConflictDoUpdate({ target: [codebase_tasks.id], set: values });
}

async function handleCreateAction(db: any, update_item: any, titles: Record<string, string>, user_id: string, project_id: string, new_id: number): Promise<void> {
	const title = titles[update_item.id] || update_item.data?.new?.text || "Untitled Task";
	const new_text = update_item.data?.new?.text || "";

	const new_task_data: UpsertTodo = {
		title,
		description: new_text,
		progress: "UNSTARTED",
		priority: "LOW",
		owner_id: user_id,
		project_id,
	};

	const { upsertTask } = await import("./tasks.d1.js");
	const task_result = await upsertTask(db, new_task_data, [], user_id);
	if (!task_result.ok || !task_result.value) return;

	await upsertCodebaseTask(db, update_item, new_id);
	await db.update(task).set({ codebase_task_id: update_item.id }).where(eq(task.id, task_result.value.task.id));
}

async function processScanItem(db: any, update_item: any, actions_map: Record<string, string[]>, titles: Record<string, string>, user_id: string, project_id: string, new_id: number): Promise<void> {
	let item_action: string | null = null;
	for (const [a, item_ids] of Object.entries(actions_map)) {
		if (item_ids.includes(update_item.id)) {
			item_action = a;
			break;
		}
	}

	if (!item_action) return;

	if (item_action === "CREATE") {
		await handleCreateAction(db, update_item, titles, user_id, project_id, new_id);
		return;
	}

	if (item_action === "CONFIRM") {
		await upsertCodebaseTask(db, update_item, new_id);
		return;
	}

	if (item_action === "UNLINK") {
		const unlink_tasks = await db.select().from(task).where(eq(task.codebase_task_id, update_item.id));
		if (unlink_tasks.length > 0) {
			await db.update(task).set({ codebase_task_id: null }).where(eq(task.codebase_task_id, update_item.id));
			await db.insert(action).values({
				owner_id: user_id,
				type: "UPDATE_TASK",
				description: "Task unlinked from codebase (via scan)",
				data: JSON.stringify({ task_id: unlink_tasks[0].id, project_id }),
			});
		}
		return;
	}

	if (item_action === "DELETE") {
		const delete_tasks = await db.select().from(task).where(eq(task.codebase_task_id, update_item.id));
		if (delete_tasks.length > 0) {
			await db.update(task).set({ visibility: "DELETED", codebase_task_id: null }).where(eq(task.codebase_task_id, update_item.id));
			await db.insert(action).values({
				owner_id: user_id,
				type: "DELETE_TASK",
				description: "Task deleted (via scan)",
				data: JSON.stringify({ task_id: delete_tasks[0].id, project_id }),
			});
		}
		return;
	}

	if (item_action === "COMPLETE") {
		const complete_tasks = await db.select().from(task).where(eq(task.codebase_task_id, update_item.id));
		if (complete_tasks.length > 0) {
			await db.update(task).set({ progress: "COMPLETED" }).where(eq(task.codebase_task_id, update_item.id));
			await db.insert(action).values({
				owner_id: user_id,
				type: "UPDATE_TASK",
				description: "Task completed (via scan)",
				data: JSON.stringify({ task_id: complete_tasks[0].id, project_id }),
			});
		}
		return;
	}
}

export async function processScanResults(
	db: any,
	project_id: string,
	user_id: string,
	update_id: number,
	actions_map: Record<string, string[]>,
	titles: Record<string, string>,
	approved: boolean
): Promise<Result<{ success: boolean }, ServiceError>> {
	const project_query = await db
		.select()
		.from(project)
		.where(and(eq(project.id, project_id), eq(project.owner_id, user_id)));

	if (project_query.length !== 1) {
		return err({ kind: "not_found", entity: "project", id: project_id });
	}

	const update_query = await db
		.select()
		.from(todo_updates)
		.where(and(eq(todo_updates.project_id, project_id), eq(todo_updates.id, update_id)));

	if (update_query.length !== 1) {
		return err({ kind: "not_found", entity: "update", id: String(update_id) });
	}

	const update_data = update_query[0];
	const new_id = update_data.new_id;

	await db.update(tracker_result).set({ accepted: approved }).where(eq(tracker_result.id, new_id));
	await db
		.update(todo_updates)
		.set({ status: approved ? "ACCEPTED" : "REJECTED" })
		.where(eq(todo_updates.id, update_id));

	if (!approved) return ok({ success: true });

	const update_items: any[] = typeof update_data.data === "string" ? JSON.parse(update_data.data) : update_data.data;

	for (const update_item of update_items) {
		await processScanItem(db, update_item, actions_map, titles, user_id, project_id, new_id);
	}

	return ok({ success: true });
}

export async function getPendingUpdates(db: any, project_id: string, user_id: string): Promise<Result<TodoUpdate[], ServiceError>> {
	const project_query = await db
		.select()
		.from(project)
		.where(and(eq(project.id, project_id), eq(project.owner_id, user_id)));

	if (project_query.length !== 1) {
		return err({ kind: "not_found", entity: "project", id: project_id });
	}

	const result = await db
		.select()
		.from(todo_updates)
		.where(and(eq(todo_updates.project_id, project_id), eq(todo_updates.status, "PENDING")))
		.orderBy(desc(todo_updates.created_at));

	return ok(result);
}

export async function getScanHistory(db: any, project_id: string, user_id: string): Promise<Result<TrackerResult[], ServiceError>> {
	const project_query = await db
		.select()
		.from(project)
		.where(and(eq(project.id, project_id), eq(project.owner_id, user_id)));

	if (project_query.length !== 1) {
		return err({ kind: "not_found", entity: "project", id: project_id });
	}

	const result = await db.select().from(tracker_result).where(eq(tracker_result.project_id, project_id)).orderBy(desc(tracker_result.created_at));

	return ok(result);
}
