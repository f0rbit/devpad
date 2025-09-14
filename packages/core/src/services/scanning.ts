import { db, project, todo_updates, tracker_result, codebase_tasks, task } from "@devpad/schema/database/server";
import { and, eq, desc } from "drizzle-orm";
import { getProjectConfig } from "./projects.js";
import { scanRepo } from "./scanner.js";
import { upsertTask } from "./tasks.js";
import type { TodoUpdate, TrackerResult, UpdateData, UpsertTodo } from "@devpad/schema";

// Make todo-tracker path configurable
const getTodoTrackerPath = () => {
	return process.env.TODO_TRACKER_PATH || "./todo-tracker";
};

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
	const itemActions = actions[updateItem.id] || [];

	for (const action of itemActions) {
		switch (action) {
			case "CREATE":
				await handleCreateAction(updateItem, titles, userId, projectId, newId);
				break;
			case "CONFIRM":
				// Just update the codebase_tasks entry to refresh metadata
				await upsertCodebaseTask(updateItem, newId);
				break;
		}
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
