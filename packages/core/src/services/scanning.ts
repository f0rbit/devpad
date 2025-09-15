import child_process from "node:child_process";
import { readdir } from "node:fs/promises";
import type { ProjectConfig } from "@devpad/schema";
import { db, project, todo_updates, tracker_result, codebase_tasks, task } from "@devpad/schema/database/server";
import { and, eq, desc } from "drizzle-orm";
import { getProjectConfig } from "./projects.js";
import { getBranches, getRepo } from "./github.js";
import { parseContextToArray } from "../utils/context-parser";
import { upsertTask, addTaskAction } from "./tasks.js";
import type { TodoUpdate, TrackerResult, UpdateData, UpsertTodo } from "@devpad/schema";

// Make todo-tracker path configurable
const getTodoTrackerPath = () => {
	return process.env.TODO_TRACKER_PATH || "./todo-tracker";
};

// Type for the return value of getProjectConfig function
type ProjectConfigResult = {
	id: string | null;
	scan_branch: string | null;
	error: string | null;
	config: ProjectConfig | null;
};

async function* scanRepo(repo_url: string, access_token: string, folder_id: string, config: ProjectConfigResult) {
	const { id: project_id, scan_branch: branch, error: config_error } = config;
	if (config_error) {
		console.error("scan_repo: error fetching project config", config_error);
		yield "error fetching project config\n";
		return;
	}

	yield "";
	yield "starting\n";
	// we need to get OWNER and REPO from the repo_url
	const slices = repo_url.split("/");
	const repo = slices.at(-1);
	const owner = slices.at(-2);

	if (!owner || !repo) {
		console.error("scan_repo: error parsing repo url", repo_url, slices);
		yield "error parsing repo url\n";
		return;
	}

	yield "cloning repo\n";
	// clone the repo into a temp folder
	let clone;
	try {
		clone = await getRepo(owner, repo, access_token, branch ?? null);
	} catch (e) {
		console.error("scan_repo: error fetching repo from github", e);
		yield "error fetching repo from github\n";
		return;
	}

	if (clone.status < 200 || clone.status >= 400) {
		console.error("scan_repo: error fetching repo from github", clone.status);
		yield "error fetching repo from github\n";
		return;
	}

	const repo_path = `/tmp/${folder_id}.zip`;
	const unzipped_path = `/tmp/${folder_id}`;
	try {
		yield "loading repo into memory\n";
		const zip = await clone.arrayBuffer();

		yield "writing repo to disk\n";
		await Bun.write(repo_path, zip);

		// call shell 'unzip'
		// await $`unzip ${repo_path} -d ${unzipped_path}`
		// call ^ using child_process
		yield "decompressing repo\n";
		child_process.execSync(`unzip ${repo_path} -d ${unzipped_path}`);
	} catch (e) {
		console.error("scan_repo: error decompressing repo", e);
		yield "error decompressing repo\n";
		return;
	}

	// the unzipped folder will have a folder inside it with the repo contents, we need that pathname for the parsing task
	const files = await readdir(unzipped_path);
	const folder_path = `${unzipped_path}/${files[0]}`;

	let config_path = "../todo-config.json";

	// if we have a project.config_json, we need to write it to a file
	if (config?.config) {
		await Bun.write(`${unzipped_path}/config.json`, JSON.stringify(config.config, null, 2));
		config_path = `${unzipped_path}/config.json`;
		// console.log("using config.json from project");
		yield "loaded config from project\n";
	}

	// TODO: add handling for user-wide config & defaults based on project type??

	// console.log("folder_path: ", folder_path);

	// generate the todo-tracker parse
	yield "scanning repo\n";
	child_process.execSync(`${getTodoTrackerPath()} parse ${folder_path} ${config_path} > ${unzipped_path}/new-output.json`);

	yield "saving output\n";
	// for now, lets return response of the new-output.json file
	const output_file = await Bun.file(`${unzipped_path}/new-output.json`).text();

	yield "saving scan\n";

	const new_tracker = await db
		.insert(tracker_result)
		.values({
			project_id: project_id!,
			data: output_file,
		})
		.returning();

	if (new_tracker.length !== 1) {
		yield "error saving scan\n";
		return;
	}

	// then we want to create a todo_update record
	// for new_id we use the id of the new insert ^^
	// and for old_id we want to the most recent tracker_result with 'accepted' as true
	yield "finding existing scan\n";
	const new_id = new_tracker[0].id;
	const old_id = await db
		.select()
		.from(tracker_result)
		.where(and(eq(tracker_result.project_id, project_id!), eq(tracker_result.accepted, true)))
		.orderBy(desc(tracker_result.created_at))
		.limit(1);

	var old_data = [] as any[];
	if (old_id.length === 1 && old_id[0].data) {
		// fetch all the codebase tasks from the old_id
		const existing_tasks = await db.select().from(codebase_tasks).where(eq(codebase_tasks.recent_scan_id, old_id[0].id));

		// transform to todo-tracker format
		old_data = existing_tasks.map(item => ({
			id: item.id,
			file: item.file,
			line: item.line,
			tag: item.type,
			text: item.text,
			context: parseContextToArray(item.context),
		}));
	}

	// write old data to old-output.json
	yield "writing old data\n";
	await Bun.write(`${unzipped_path}/old-output.json`, JSON.stringify(old_data));

	// console.log("running diff");
	// run diff script and write to diff-output.json
	yield "running diff\n";
	try {
		child_process.execSync(`${getTodoTrackerPath()} diff ${unzipped_path}/old-output.json ${unzipped_path}/new-output.json > ${unzipped_path}/diff-output.json 2> ${unzipped_path}/err.out`);
	} catch (e) {
		console.error(e);
		yield "error running diff\n";
		return;
	}

	// read diff-output.json
	yield "reading diff\n";
	const diff = await Bun.file(`${unzipped_path}/diff-output.json`).text();

	yield "ignoring old updates\n";
	// update any old todo_updates that had status == "PENDING" to status == "IGNORED"
	try {
		await db
			.update(todo_updates)
			.set({ status: "IGNORED" })
			.where(and(eq(todo_updates.project_id, project_id!), eq(todo_updates.status, "PENDING")));
	} catch (e) {
		console.error(e);
		yield "error ignoring old updates\n";
		return;
	}

	const branch_info = {} as { branch?: string | null; commit_sha?: string | null; commit_msg?: string | null; commit_url?: string | null };
	if (branch) {
		// find the branch that we scanned
		yield "fetching branch info\n";
		const branches = await getBranches(owner, repo, access_token);
		/** @todo type this properly */
		const found = branches.find((b: any) => b.name === branch);
		// console.log(branch, branches, found);
		if (found) {
			branch_info.commit_sha = found.commit.sha;
			branch_info.commit_msg = found.commit.message;
			branch_info.branch = found.name;
			branch_info.commit_url = found.commit.url;
		}
	}

	yield "saving update\n";
	await db
		.insert(todo_updates)
		.values({
			project_id: project_id!,
			new_id: new_id,
			old_id: old_id[0]?.id ?? null,
			data: diff,
			...branch_info,
		})
		.returning();

	yield "done\n";
	return;
}

/**
 * Initiate repository scan - returns async generator for streaming results
 * This is a wrapper around the core scanRepo function that validates ownership
 */
export async function* initiateScan(projectId: string, userId: string, accessToken: string): AsyncGenerator<string> {
	try {
		// Validate project ownership
		const projectQuery = await db
			.select()
			.from(project)
			.where(and(eq(project.id, projectId), eq(project.owner_id, userId)));

		if (projectQuery.length !== 1) {
			yield "error: project not found or access denied\n";
			return;
		}

		const projectData = projectQuery[0];

		if (!projectData.repo_id || !projectData.repo_url) {
			yield "error: project is not linked to a repository\n";
			return;
		}

		// Get project configuration
		let config;
		try {
			config = await getProjectConfig(projectId);
		} catch (e) {
			console.error("scan: error fetching project config", e);
			yield "error: failed to fetch project configuration\n";
			return;
		}

		if (config.error) {
			yield `error: ${config.error}\n`;
			return;
		}

		// Generate unique folder ID for this scan
		const folderId = `${userId}-${crypto.randomUUID()}`;

		// Use the real scanRepo function
		yield* scanRepo(projectData.repo_url, accessToken, folderId, config);
	} catch (error) {
		console.error("Scan error:", error);
		yield "error: scan failed\n";
	}
}

/**
 * Process scan results and update tasks/codebase mappings
 */
// Helper function to create codebase_tasks values
function createCodebaseTaskValues(updateItem: any, newId: number): any {
	const newText = updateItem.data?.new?.text || "";
	return {
		id: updateItem.id,
		text: newText,
		line: updateItem.data?.new?.line || 0,
		file: updateItem.data?.new?.file || "unknown",
		type: updateItem.tag || "todo",
		context: updateItem.data?.new?.context ? JSON.stringify(updateItem.data.new.context) : null,
		recent_scan_id: newId,
		updated_at: new Date().toISOString(),
	};
}

// Helper function to upsert codebase_tasks entry
async function upsertCodebaseTask(updateItem: any, newId: number): Promise<void> {
	const values = createCodebaseTaskValues(updateItem, newId);
	await db
		.insert(codebase_tasks)
		.values(values)
		.onConflictDoUpdate({
			target: [codebase_tasks.id],
			set: values,
		});
}

// Helper function to handle CREATE action
async function handleCreateAction(updateItem: any, titles: Record<string, string>, userId: string, projectId: string, newId: number): Promise<void> {
	const title = titles[updateItem.id] || updateItem.data?.new?.text || "Untitled Task";
	const newText = updateItem.data?.new?.text || "";

	const newTaskData: UpsertTodo = {
		title,
		description: newText,
		progress: "UNSTARTED",
		priority: "LOW",
		owner_id: userId,
		project_id: projectId,
	};

	const newTask = await upsertTask(newTaskData, [], userId);
	if (!newTask || !newTask.task) {
		console.error("Failed to create task");
		return;
	}

	// Create/update codebase_tasks entry with upsert logic
	await upsertCodebaseTask(updateItem, newId);

	// Link task to codebase_tasks entry
	await db.update(task).set({ codebase_task_id: updateItem.id }).where(eq(task.id, newTask.task.id));
}

// Helper function to process a single scan item
async function processScanItem(updateItem: any, actions: Record<string, string[]>, titles: Record<string, string>, userId: string, projectId: string, newId: number): Promise<void> {
	// Find which action applies to this item
	// actions is structured as { "CREATE": ["id1", "id2"], "CONFIRM": ["id3"] }
	let itemAction: string | null = null;

	for (const [action, itemIds] of Object.entries(actions)) {
		if (itemIds.includes(updateItem.id)) {
			itemAction = action;
			break;
		}
	}

	if (!itemAction) {
		// No action specified for this item, skip it
		return;
	}

	switch (itemAction) {
		case "CREATE":
			await handleCreateAction(updateItem, titles, userId, projectId, newId);
			break;
		case "CONFIRM":
			// Just update the codebase_tasks entry to refresh metadata
			await upsertCodebaseTask(updateItem, newId);
			break;
		case "UNLINK":
			// Unlink the task from codebase by setting codebase_task_id to null
			const unlinkTasks = await db.select().from(task).where(eq(task.codebase_task_id, updateItem.id));
			if (unlinkTasks.length > 0) {
				await db.update(task).set({ codebase_task_id: null }).where(eq(task.codebase_task_id, updateItem.id));
				await addTaskAction({
					owner_id: userId,
					task_id: unlinkTasks[0].id,
					type: "UPDATE_TASK",
					description: "Task unlinked from codebase (via scan)",
					project_id: projectId,
				});
			}
			break;
		case "DELETE":
			// Mark task as deleted
			const deleteTasks = await db.select().from(task).where(eq(task.codebase_task_id, updateItem.id));
			if (deleteTasks.length > 0) {
				await db.update(task).set({ visibility: "DELETED", codebase_task_id: null }).where(eq(task.codebase_task_id, updateItem.id));
				await addTaskAction({
					owner_id: userId,
					task_id: deleteTasks[0].id,
					type: "DELETE_TASK",
					description: "Task deleted (via scan)",
					project_id: projectId,
				});
			}
			break;
		case "COMPLETE":
			// Mark task as completed
			const completeTasks = await db.select().from(task).where(eq(task.codebase_task_id, updateItem.id));
			if (completeTasks.length > 0) {
				await db.update(task).set({ progress: "COMPLETED" }).where(eq(task.codebase_task_id, updateItem.id));
				await addTaskAction({
					owner_id: userId,
					task_id: completeTasks[0].id,
					type: "UPDATE_TASK",
					description: "Task completed (via scan)",
					project_id: projectId,
				});
			}
			break;
		case "IGNORE":
			// Do nothing, just skip this item
			break;
	}
}

// Helper function to process approved scan results
async function processApprovedResults(updateData: any, actions: Record<string, string[]>, titles: Record<string, string>, userId: string, projectId: string, newId: number): Promise<void> {
	const updateItems: any[] = typeof updateData.data === "string" ? JSON.parse(updateData.data) : updateData.data;

	console.log(
		`Found ${updateItems.length} diff items:`,
		updateItems.slice(0, 3).map(item => ({
			id: item.id,
			type: item.type,
			tag: item.tag,
			text: item.data?.new?.text || "unknown",
		}))
	);

	// Process each item in the diff
	for (const updateItem of updateItems) {
		await processScanItem(updateItem, actions, titles, userId, projectId, newId);
	}
}

export async function processScanResults(projectId: string, userId: string, updateId: number, actions: Record<string, string[]>, titles: Record<string, string>, approved: boolean): Promise<{ success: boolean; error?: string }> {
	try {
		// Validate project ownership
		const projectQuery = await db
			.select()
			.from(project)
			.where(and(eq(project.id, projectId), eq(project.owner_id, userId)));

		if (projectQuery.length !== 1) {
			return { success: false, error: "Project not found or access denied" };
		}

		// Check that there is an update with the given id
		const updateQuery = await db
			.select()
			.from(todo_updates)
			.where(and(eq(todo_updates.project_id, projectId), eq(todo_updates.id, updateId)));

		if (updateQuery.length !== 1) {
			return { success: false, error: "Update not found" };
		}

		const updateData = updateQuery[0];
		const newId = updateData.new_id;

		// Update tracker result status
		await db.update(tracker_result).set({ accepted: approved }).where(eq(tracker_result.id, newId));

		// Update todo_updates status
		await db
			.update(todo_updates)
			.set({ status: approved ? "ACCEPTED" : "REJECTED" })
			.where(eq(todo_updates.id, updateId));

		// Early return if not approved
		if (!approved) {
			return { success: true };
		}

		// Process approved results
		await processApprovedResults(updateData, actions, titles, userId, projectId, newId);

		return { success: true };
	} catch (error) {
		console.error("Process scan results error:", error);
		return { success: false, error: "Failed to process scan results" };
	}
}

/**
 * Scan local directory instead of downloading from GitHub
 * Useful for testing with the current repository
 */
export async function* scanLocalRepo(projectId: string, localPath: string, configPath?: string): AsyncGenerator<string> {
	try {
		const child_process = await import("node:child_process");
		const { readdir } = await import("node:fs/promises");

		yield "starting local scan\n";

		// Generate unique folder ID for temp files
		const folderId = `local-${crypto.randomUUID()}`;
		const tempPath = `/tmp/${folderId}`;

		// Use provided config or default
		const todoConfigPath = configPath || "./todo-config.json";

		yield "scanning local repository\n";

		// Run todo-tracker directly on the local path
		try {
			child_process.execSync(`${getTodoTrackerPath()} parse ${localPath} ${todoConfigPath} > ${tempPath}-output.json`, {
				cwd: localPath, // Execute from the project root where the binary is located
			});
		} catch (e) {
			console.error("scan_local: error running todo-tracker", e);
			yield "error: failed to run todo-tracker\n";
			return;
		}

		yield "reading scan results\n";

		// Read the output
		const outputFile = await Bun.file(`${tempPath}-output.json`).text();

		yield "processing results\n";

		// Save to database
		const newTracker = await db
			.insert(tracker_result)
			.values({
				project_id: projectId,
				data: outputFile,
			})
			.returning();

		if (newTracker.length !== 1) {
			yield "error: failed to save scan results\n";
			return;
		}

		yield "scan completed successfully\n";
		yield `results saved with ID: ${newTracker[0].id}\n`;

		// Return the parsed results for validation
		try {
			const parsedResults = JSON.parse(outputFile);
			yield `found ${parsedResults.length || 0} items\n`;
		} catch (e) {
			yield "warning: could not parse results for counting\n";
		}
	} catch (error) {
		console.error("Local scan error:", error);
		yield "error: local scan failed\n";
	}
}

/**
 * Get pending scan updates for a project
 */
export async function getPendingUpdates(projectId: string, userId: string): Promise<TodoUpdate[]> {
	// Validate project ownership
	const projectQuery = await db
		.select()
		.from(project)
		.where(and(eq(project.id, projectId), eq(project.owner_id, userId)));

	if (projectQuery.length !== 1) {
		throw new Error("Project not found or access denied");
	}

	// Get pending updates
	return await db
		.select()
		.from(todo_updates)
		.where(and(eq(todo_updates.project_id, projectId), eq(todo_updates.status, "PENDING")))
		.orderBy(desc(todo_updates.created_at));
}

/**
 * Get scan history for a project
 */
export async function getScanHistory(projectId: string, userId: string): Promise<TrackerResult[]> {
	// Validate ownership first
	const projectQuery = await db
		.select()
		.from(project)
		.where(and(eq(project.id, projectId), eq(project.owner_id, userId)));

	if (projectQuery.length !== 1) {
		throw new Error("Project not found or access denied");
	}

	return await db.select().from(tracker_result).where(eq(tracker_result.project_id, projectId)).orderBy(desc(tracker_result.created_at));
}
