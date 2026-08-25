#!/usr/bin/env bun

import { ApiClient, getTool } from "@devpad/api";
import chalk from "chalk";
import { Command } from "commander";
import { Table } from "console-table-printer";
import { register_pipelines_commands } from "./commands/pipelines";
import { register_graph_commands } from "./graph-commands";
import { register_plans_commands } from "./plans-commands";
import { make_spinner as createSpinner } from "./printer";
import { resolve_owner_id, task_status_to_progress } from "./task-progress";
import { parse_task_response } from "./task-response";
import { type TaskUpdateOptions, build_task_update_input } from "./task-update";

// Helper to get API client
function getApiClient(): ApiClient {
	const apiKey = process.env.DEVPAD_API_KEY || Bun.env.DEVPAD_API_KEY;
	const baseUrl = process.env.DEVPAD_BASE_URL || "https://devpad.tools/api/v1";

	if (!apiKey) {
		console.error(chalk.red("Error: DEVPAD_API_KEY environment variable is required"));
		console.error(chalk.yellow("Get your API key from https://devpad.tools/account"));
		process.exit(1);
	}

	return new ApiClient({
		api_key: apiKey,
		base_url: baseUrl,
	});
}

// Helper to handle errors
function handleError(error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	console.error(chalk.red(`Error: ${message}`));
	process.exit(1);
}

async function formatOutput(data: unknown, format: string = "json") {
	if (format === "json") {
		const output = JSON.stringify(data, null, 2) + "\n";
		const flushed = process.stdout.write(output);
		if (!flushed) {
			await new Promise<void>((resolve) => process.stdout.once("drain", resolve));
		}
	} else if (format === "table" && Array.isArray(data)) {
		const table = new Table();
		data.forEach((item: unknown) => table.addRow(item as Record<string, unknown>));
		table.printTable();
	} else {
		console.log(data);
	}
}

const program = new Command();

program.name("devpad").description("CLI for devpad project and task management").version("0.1.0");

// Projects command group
const projects = program.command("projects").description("Manage projects");

projects
	.command("list")
	.description("List all projects")
	.option("--private", "Include private projects", true)
	.option("-f, --format <format>", "Output format (json|table)", "json")
	.action(async (options) => {
		const spinner = createSpinner("Fetching projects...").start();
		try {
			const tool = getTool("devpad_projects_list");
			if (!tool) throw new Error("Tool not found");

			const client = getApiClient();
			const result = await tool.execute(client, { private: options.private });
			spinner.succeed("Projects fetched");
			await formatOutput(result, options.format);
		} catch (error) {
			spinner.fail("Failed to fetch projects");
			handleError(error);
		}
	});

projects
	.command("get <idOrName>")
	.description("Get a project by ID or name")
	.option("-f, --format <format>", "Output format (json|table)", "json")
	.action(async (idOrName, options) => {
		const spinner = createSpinner("Fetching project...").start();
		try {
			const tool = getTool("devpad_projects_get");
			if (!tool) throw new Error("Tool not found");

			const client = getApiClient();
			// Try ID first, then name
			const input = idOrName.includes("-") ? { id: idOrName } : { name: idOrName };
			const result = await tool.execute(client, input);
			spinner.succeed("Project fetched");
			await formatOutput(result, options.format);
		} catch (error) {
			spinner.fail("Failed to fetch project");
			handleError(error);
		}
	});

projects
	.command("create")
	.description("Create a new project")
	.requiredOption("-n, --name <name>", "Project name")
	.option("-d, --description <description>", "Project description")
	.option("--private", "Make project private", false)
	.action(async (options) => {
		const spinner = createSpinner("Creating project...").start();
		try {
			const tool = getTool("devpad_projects_upsert");
			if (!tool) throw new Error("Tool not found");

			const client = getApiClient();
			const result = await tool.execute(client, {
				name: options.name,
				description: options.description,
				private: options.private,
			});
			spinner.succeed(`Project "${String(result.name)}" created`);
			console.log(chalk.green(`ID: ${String(result.id)}`));
		} catch (error) {
			spinner.fail("Failed to create project");
			handleError(error);
		}
	});

projects
	.command("delete <id>")
	.description("Delete a project")
	.option("-y, --yes", "Skip confirmation", false)
	.action(async (id, options) => {
		if (!options.yes) {
			console.log(chalk.yellow("Are you sure you want to delete this project? Use --yes to confirm"));
			return;
		}

		const spinner = createSpinner("Deleting project...").start();
		try {
			const tool = getTool("devpad_projects_delete");
			if (!tool) throw new Error("Tool not found");

			const client = getApiClient();
			await tool.execute(client, { id });
			spinner.succeed("Project deleted");
		} catch (error) {
			spinner.fail("Failed to delete project");
			handleError(error);
		}
	});

projects
	.command("history <id>")
	.description("Get project history")
	.option("-f, --format <format>", "Output format (json|table)", "json")
	.action(async (id, options) => {
		const spinner = createSpinner("Fetching project history...").start();
		try {
			const tool = getTool("devpad_projects_history");
			if (!tool) throw new Error("Tool not found");

			const client = getApiClient();
			const result = await tool.execute(client, { project_id: id });
			spinner.succeed("Project history fetched");
			await formatOutput(result, options.format);
		} catch (error) {
			spinner.fail("Failed to fetch project history");
			handleError(error);
		}
	});

// Tasks command group
const tasks = program.command("tasks").description("Manage tasks");

tasks
	.command("list")
	.description("List tasks")
	.option("-p, --project <id>", "Filter by project ID")
	.option("-t, --tag <id>", "Filter by tag ID")
	.option("-f, --format <format>", "Output format (json|table)", "json")
	.action(async (options) => {
		const spinner = createSpinner("Fetching tasks...").start();
		try {
			const tool = getTool("devpad_tasks_list");
			if (!tool) throw new Error("Tool not found");

			const client = getApiClient();
			const result = await tool.execute(client, {
				project_id: options.project,
				tag_id: options.tag,
			});
			spinner.succeed("Tasks fetched");
			await formatOutput(result, options.format);
		} catch (error) {
			spinner.fail("Failed to fetch tasks");
			handleError(error);
		}
	});

tasks
	.command("get <id>")
	.description("Get a task by ID")
	.option("-f, --format <format>", "Output format (json|table)", "json")
	.action(async (id, options) => {
		const spinner = createSpinner("Fetching task...").start();
		try {
			const tool = getTool("devpad_tasks_get");
			if (!tool) throw new Error("Tool not found");

			const client = getApiClient();
			const result = await tool.execute(client, { id });
			spinner.succeed("Task fetched");
			await formatOutput(result, options.format);
		} catch (error) {
			spinner.fail("Failed to fetch task");
			handleError(error);
		}
	});

tasks
	.command("create")
	.description("Create a new task")
	.requiredOption("-t, --title <title>", "Task title")
	.requiredOption("-p, --project <id>", "Project ID")
	.option("-s, --summary <summary>", "Task summary")
	.option("--priority <priority>", "Task priority (low|medium|high)", "medium")
	.option("--status <status>", "Task status (todo|in_progress|done)", "todo")
	.action(async (options) => {
		const spinner = createSpinner("Creating task...").start();
		try {
			const tool = getTool("devpad_tasks_upsert");
			if (!tool) throw new Error("Tool not found");

			const client = getApiClient();
			const owner_id = await resolve_owner_id(client);
			const result = await tool.execute(client, {
				title: options.title,
				project_id: options.project,
				summary: options.summary,
				priority: options.priority.toUpperCase(),
				progress: task_status_to_progress(options.status) ?? "UNSTARTED",
				owner_id,
			});
			const { task } = parse_task_response(result);
			spinner.succeed(`Task "${task.title}" created`);
			console.log(chalk.green(`ID: ${task.id}`));
		} catch (error) {
			spinner.fail("Failed to create task");
			handleError(error);
		}
	});

tasks
	.command("update <id>")
	.description("Update a task (partial — only provided flags change)")
	.option("--status <status>", "Task status (todo|in_progress|done)")
	.option("-t, --title <title>", "Task title")
	.option("-s, --summary <summary>", "Task summary")
	.option("--priority <priority>", "Task priority (low|medium|high)")
	.action(async (id, options: TaskUpdateOptions) => {
		const input = build_task_update_input(id, options);
		if (!input) {
			handleError(new Error("No fields to update — pass at least one of --status, --title, --summary, --priority"));
			return;
		}

		const spinner = createSpinner("Updating task...").start();
		try {
			const tool = getTool("devpad_tasks_upsert");
			if (!tool) throw new Error("Tool not found");

			const client = getApiClient();
			const owner_id = await resolve_owner_id(client);
			const result = await tool.execute(client, { ...input, owner_id });
			const { task } = parse_task_response(result);
			spinner.succeed(`Task "${task.title}" updated`);
		} catch (error) {
			spinner.fail("Failed to update task");
			handleError(error);
		}
	});

tasks
	.command("done <id>")
	.description("Mark a task as done through the completion engine (bubbles an auto_children cascade up the tree)")
	.option("--json", "Print the raw { completed, bubbled, hooks_fired } response as JSON instead of a summary")
	.action(async (id: string, options: { json?: boolean }) => {
		const spinner = createSpinner("Marking task as done...").start();
		try {
			const get_tool = getTool("devpad_tasks_get");
			const done_tool = getTool("devpad_tasks_done");
			if (!get_tool || !done_tool) throw new Error("Tool not found");

			const client = getApiClient();
			const current = parse_task_response(await get_tool.execute(client, { id }));
			if (current.task.rev === undefined) throw new Error("Task response is missing rev");

			const result = await done_tool.execute(client, { id, base_rev: current.task.rev });

			if (options.json) {
				spinner.stop();
				console.log(JSON.stringify(result, null, 2));
				return;
			}

			const bubbled = Array.isArray((result as { bubbled?: unknown }).bubbled)
				? (result as { bubbled: { task: { title: string } }[] }).bubbled
				: [];
			const bubbled_note =
				bubbled.length > 0
					? ` (+${String(bubbled.length)} bubbled: ${bubbled.map((b) => b.task.title).join(", ")})`
					: "";
			spinner.succeed(`Task "${current.task.title}" marked as done${bubbled_note}`);
		} catch (error) {
			spinner.fail("Failed to mark task as done");
			handleError(error);
		}
	});

tasks
	.command("todo <id>")
	.description("Mark a task as todo")
	.action(async (id) => {
		const spinner = createSpinner("Marking task as todo...").start();
		try {
			const tool = getTool("devpad_tasks_upsert");
			if (!tool) throw new Error("Tool not found");

			const client = getApiClient();
			const owner_id = await resolve_owner_id(client);
			const result = await tool.execute(client, {
				id,
				owner_id,
				progress: "UNSTARTED",
			});
			const { task } = parse_task_response(result);
			spinner.succeed(`Task "${task.title}" marked as todo`);
		} catch (error) {
			spinner.fail("Failed to update task");
			handleError(error);
		}
	});

tasks
	.command("delete <id>")
	.description("Delete a task")
	.option("-y, --yes", "Skip confirmation", false)
	.action(async (id, options) => {
		if (!options.yes) {
			console.log(chalk.yellow("Are you sure you want to delete this task? Use --yes to confirm"));
			return;
		}

		const spinner = createSpinner("Deleting task...").start();
		try {
			const tool = getTool("devpad_tasks_delete");
			if (!tool) throw new Error("Tool not found");

			const client = getApiClient();
			await tool.execute(client, { id });
			spinner.succeed("Task deleted");
		} catch (error) {
			spinner.fail("Failed to delete task");
			handleError(error);
		}
	});

tasks
	.command("history <id>")
	.description("Get task history")
	.option("-f, --format <format>", "Output format (json|table)", "json")
	.action(async (id, options) => {
		const spinner = createSpinner("Fetching task history...").start();
		try {
			const tool = getTool("devpad_tasks_history");
			if (!tool) throw new Error("Tool not found");

			const client = getApiClient();
			const result = await tool.execute(client, { task_id: id });
			spinner.succeed("Task history fetched");
			await formatOutput(result, options.format);
		} catch (error) {
			spinner.fail("Failed to fetch task history");
			handleError(error);
		}
	});

// Milestones command group
const milestones = program.command("milestones").description("Manage milestones");

milestones
	.command("list")
	.description("List milestones")
	.option("-p, --project <id>", "Filter by project ID")
	.option("-f, --format <format>", "Output format (json|table)", "json")
	.action(async (options) => {
		const spinner = createSpinner("Fetching milestones...").start();
		try {
			const tool = getTool("devpad_milestones_list");
			if (!tool) throw new Error("Tool not found");

			const client = getApiClient();
			const result = await tool.execute(client, {
				project_id: options.project,
			});
			spinner.succeed("Milestones fetched");
			await formatOutput(result, options.format);
		} catch (error) {
			spinner.fail("Failed to fetch milestones");
			handleError(error);
		}
	});

milestones
	.command("create")
	.description("Create a new milestone")
	.requiredOption("-n, --name <name>", "Milestone name")
	.requiredOption("-p, --project <id>", "Project ID")
	.option("-d, --description <description>", "Milestone description")
	.option("--target-time <time>", "Target completion time")
	.option("--target-version <version>", "Target version")
	.action(async (options) => {
		const spinner = createSpinner("Creating milestone...").start();
		try {
			const tool = getTool("devpad_milestones_upsert");
			if (!tool) throw new Error("Tool not found");

			const client = getApiClient();
			const result = await tool.execute(client, {
				name: options.name,
				project_id: options.project,
				description: options.description,
				target_time: options.targetTime,
				target_version: options.targetVersion,
			});
			spinner.succeed(`Milestone "${String(result.name)}" created`);
			console.log(chalk.green(`ID: ${String(result.id)}`));
		} catch (error) {
			spinner.fail("Failed to create milestone");
			handleError(error);
		}
	});

// Goals command group
const goals = program.command("goals").description("Manage goals");

goals
	.command("list")
	.description("List goals")
	.option("-f, --format <format>", "Output format (json|table)", "json")
	.action(async (options) => {
		const spinner = createSpinner("Fetching goals...").start();
		try {
			const tool = getTool("devpad_goals_list");
			if (!tool) throw new Error("Tool not found");

			const client = getApiClient();
			const result = await tool.execute(client, {});
			spinner.succeed("Goals fetched");
			await formatOutput(result, options.format);
		} catch (error) {
			spinner.fail("Failed to fetch goals");
			handleError(error);
		}
	});

goals
	.command("create")
	.description("Create a new goal")
	.requiredOption("-n, --name <name>", "Goal name")
	.requiredOption("-m, --milestone <id>", "Milestone ID")
	.option("-d, --description <description>", "Goal description")
	.option("--target-time <time>", "Target completion time")
	.action(async (options) => {
		const spinner = createSpinner("Creating goal...").start();
		try {
			const tool = getTool("devpad_goals_upsert");
			if (!tool) throw new Error("Tool not found");

			const client = getApiClient();
			const result = await tool.execute(client, {
				name: options.name,
				milestone_id: options.milestone,
				description: options.description,
				target_time: options.targetTime,
			});
			spinner.succeed(`Goal "${String(result.name)}" created`);
			console.log(chalk.green(`ID: ${String(result.id)}`));
		} catch (error) {
			spinner.fail("Failed to create goal");
			handleError(error);
		}
	});

// Tags command group
const tags = program.command("tags").description("Manage tags");

tags
	.command("list")
	.description("List tags")
	.option("-f, --format <format>", "Output format (json|table)", "json")
	.action(async (options) => {
		const spinner = createSpinner("Fetching tags...").start();
		try {
			const tool = getTool("devpad_tags_list");
			if (!tool) throw new Error("Tool not found");

			const client = getApiClient();
			const result = await tool.execute(client, {});
			spinner.succeed("Tags fetched");
			await formatOutput(result, options.format);
		} catch (error) {
			spinner.fail("Failed to fetch tags");
			handleError(error);
		}
	});

// GitHub command group
const github = program.command("github").description("GitHub integration");

github
	.command("repos")
	.description("List GitHub repositories")
	.option("-f, --format <format>", "Output format (json|table)", "json")
	.action(async (options) => {
		const spinner = createSpinner("Fetching GitHub repositories...").start();
		try {
			const tool = getTool("devpad_github_repos");
			if (!tool) throw new Error("Tool not found");

			const client = getApiClient();
			const result = await tool.execute(client, {});
			spinner.succeed("Repositories fetched");
			await formatOutput(result, options.format);
		} catch (error) {
			spinner.fail("Failed to fetch repositories");
			handleError(error);
		}
	});

github
	.command("branches <owner> <repo>")
	.description("List branches for a GitHub repository")
	.option("-f, --format <format>", "Output format (json|table)", "json")
	.action(async (owner, repo, options) => {
		const spinner = createSpinner("Fetching branches...").start();
		try {
			const tool = getTool("devpad_github_branches");
			if (!tool) throw new Error("Tool not found");

			const client = getApiClient();
			const result = await tool.execute(client, { owner, repo });
			spinner.succeed("Branches fetched");
			await formatOutput(result, options.format);
		} catch (error) {
			spinner.fail("Failed to fetch branches");
			handleError(error);
		}
	});

// API keys command group (task A3.1 — per-project scoped keys)
const keysCmd = program.command("keys").description("Manage API keys");

keysCmd
	.command("list")
	.description("List your API keys")
	.option("-f, --format <format>", "Output format (json|table)", "json")
	.action(async (options) => {
		const spinner = createSpinner("Fetching API keys...").start();
		try {
			const client = getApiClient();
			const result = await client.auth.keys.list();
			if (!result.ok) throw new Error(result.error.message);
			spinner.succeed("API keys fetched");
			await formatOutput(result.value, options.format);
		} catch (error) {
			spinner.fail("Failed to fetch API keys");
			handleError(error);
		}
	});

keysCmd
	.command("create")
	.description("Create a new API key")
	.option("-n, --name <name>", "Key name")
	.option("-s, --scope <scope>", "Key scope (devpad|blog|media|pulse|all)", "devpad")
	.option("-p, --project <id>", "Scope this key to a single project (least privilege — omit for an all-projects key)")
	.option("-f, --format <format>", "Output format (json|table)", "json")
	.action(async (options) => {
		const spinner = createSpinner("Creating API key...").start();
		try {
			const client = getApiClient();
			const result = await client.auth.keys.create({
				name: options.name,
				scope: options.scope,
				project_id: options.project,
			});
			if (!result.ok) throw new Error(result.error.message);
			spinner.succeed("API key created — save the raw key now, it won't be shown again");
			await formatOutput(result.value, options.format);
		} catch (error) {
			spinner.fail("Failed to create API key");
			handleError(error);
		}
	});

keysCmd
	.command("revoke <id>")
	.description("Revoke an API key")
	.action(async (id: string) => {
		const spinner = createSpinner("Revoking API key...").start();
		try {
			const client = getApiClient();
			const result = await client.auth.keys.revoke(id);
			if (!result.ok) throw new Error(result.error.message);
			spinner.succeed("API key revoked");
		} catch (error) {
			spinner.fail("Failed to revoke API key");
			handleError(error);
		}
	});

// User command group
const user = program.command("user").description("User preferences and history");

user
	.command("history")
	.description("Get user activity history")
	.option("-f, --format <format>", "Output format (json|table)", "json")
	.action(async (options) => {
		const spinner = createSpinner("Fetching user history...").start();
		try {
			const tool = getTool("devpad_user_history");
			if (!tool) throw new Error("Tool not found");

			const client = getApiClient();
			const result = await tool.execute(client, {});
			spinner.succeed("User history fetched");
			await formatOutput(result, options.format);
		} catch (error) {
			spinner.fail("Failed to fetch user history");
			handleError(error);
		}
	});

user
	.command("preferences")
	.description("Update user preferences")
	.requiredOption("-u, --user-id <id>", "User ID")
	.requiredOption("-v, --view <view>", "Task view preference (list|grid)")
	.action(async (options) => {
		const spinner = createSpinner("Updating preferences...").start();
		try {
			const tool = getTool("devpad_user_preferences");
			if (!tool) throw new Error("Tool not found");

			const client = getApiClient();
			await tool.execute(client, {
				id: options.userId,
				task_view: options.view,
			});
			spinner.succeed("Preferences updated");
		} catch (error) {
			spinner.fail("Failed to update preferences");
			handleError(error);
		}
	});

// v2.4 graph verbs — `ready` (top-level) + `tasks tree|near|claim|link|unlink|apply`.
register_graph_commands(program, tasks, getApiClient);

// v2.4 docs verbs (task A4.1) — `plans push|pull|versions|list`.
register_plans_commands(program, getApiClient);

// Pipelines subcommand group — `init` is fully local (no API key);
// `artifacts upload` runs locally against the corpus backend;
// `run` / `approve` / `cancel` / `rollback` use the default API client.
register_pipelines_commands(program, () => getApiClient());

await program.parseAsync(process.argv);
