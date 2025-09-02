import { db, project, todo_updates, tracker_result } from "@devpad/schema/database";
import { and, eq } from "drizzle-orm";
import { getProjectConfig } from "./projects.js";
import { scanRepo } from "./scanner.js";

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
			// In a real implementation, this would process all the actions
			// For now, just log what would be processed
			// console.log("Processing scan actions:", {
			// 	updateId,
			// 	actions,
			// 	titles,
			// 	projectId,
			// 	userId,
			// });
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
			child_process.execSync(`./todo-tracker parse ${localPath} ${todoConfigPath} > ${tempPath}-output.json`, {
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
