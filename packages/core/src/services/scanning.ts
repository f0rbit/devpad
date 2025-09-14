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

		if (approved) {
			// Get the diff data from todo_updates, not tracker_result
			const updateData = updateQuery[0];
			let updateItems: UpdateData[];

			try {
				updateItems = typeof updateData.data === "string" ? JSON.parse(updateData.data) : updateData.data;

				console.log(
					`Found ${updateItems.length} diff items:`,
					updateItems.slice(0, 3).map(item => ({
						id: item.id,
						type: item.type,
						hasData: !!item.data,
						dataKeys: item.data ? Object.keys(item.data) : [],
					}))
				);
			} catch (error) {
				console.error("Failed to parse update data:", error);
				return { success: false, error: "Failed to parse update data" };
			}
			// Process each action
			for (const [action, taskIds] of Object.entries(actions)) {
				for (const taskId of taskIds) {
					const updateItem = updateItems.find(item => item.id === taskId);
					if (!updateItem) continue;

					console.log(`Processing action ${action} for taskId ${taskId}:`, JSON.stringify(updateItem, null, 2));

					switch (action) {
						case "CREATE": {
							// Create new task from scan data
							const newText = updateItem.data?.new?.text || (updateItem as any).text || "Untitled TODO";
							const title = titles[taskId] || newText.substring(0, 100);
							const newTaskData: UpsertTodo = {
								title,
								description: newText,
								progress: "UNSTARTED",
								priority: "LOW",
								owner_id: userId,
								project_id: projectId,
							};

							const newTask = await upsertTask(
								newTaskData,
								[
									{
										title: updateItem.tag,
										color: null,
										deleted: false,
										owner_id: userId,
										render: true,
									},
								],
								userId
							);

							if (newTask) {
								// Create codebase_tasks entry linking task to scan data
								await db.insert(codebase_tasks).values({
									id: updateItem.id,
									text: newText,
									line: updateItem.data?.new?.line || (updateItem as any).line || 0,
									file: updateItem.data?.new?.file || (updateItem as any).file || "unknown",
									type: updateItem.tag || (updateItem as any).type,
									context: updateItem.data?.new?.context || (updateItem as any).context || null,
									recent_scan_id: newId,
								});

								// Link task to codebase_tasks entry
								await db.update(task).set({ codebase_task_id: updateItem.id }).where(eq(task.id, newTask.task.id));
							}
							break;
						}
						case "CONFIRM": {
							// Update existing task if title changed
							if (titles[taskId]) {
								const existingTask = await db.select().from(task).where(eq(task.codebase_task_id, taskId));

								if (existingTask.length > 0) {
									await db
										.update(task)
										.set({
											title: titles[taskId],
											updated_at: new Date().toISOString(),
										})
										.where(eq(task.id, existingTask[0].id));
								}
							}
							break;
						}
						case "COMPLETE":
						case "DELETE": {
							// Mark task as completed
							const taskToComplete = await db.select().from(task).where(eq(task.codebase_task_id, taskId));

							if (taskToComplete.length > 0) {
								await db
									.update(task)
									.set({
										progress: "COMPLETED",
										updated_at: new Date().toISOString(),
									})
									.where(eq(task.id, taskToComplete[0].id));
							}
							break;
						}
						case "UNLINK":
							// Remove codebase_tasks link but keep the task
							await db.delete(codebase_tasks).where(eq(codebase_tasks.id, taskId));
							break;

						case "IGNORE":
							// Do nothing - user chose to ignore this item
							break;

						default:
							console.warn(`Unknown action: ${action} for task ${taskId}`);
							break;
					}
				}
			}

			console.log(`✅ Processed ${Object.keys(actions).length} action types with ${Object.values(actions).flat().length} total items`);
		}

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
