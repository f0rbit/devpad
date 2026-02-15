#!/usr/bin/env bun

import { ApiClient, getTool } from "@devpad/api";
import chalk from "chalk";
import { Command } from "commander";
import { Table } from "console-table-printer";
import ora from "ora";

const isTTY = process.stdout.isTTY;

function createSpinner(text: string) {
	if (isTTY) {
		return ora(text);
	}
	const noop = () => noopSpinner;
	const noopSpinner = { start: noop, succeed: noop, fail: noop, stop: noop };
	return noopSpinner;
}

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
function handleError(error: any) {
	const message = error instanceof Error ? error.message : String(error);
	console.error(chalk.red(`Error: ${message}`));
	process.exit(1);
}

async function formatOutput(data: any, format: string = "json") {
	if (format === "json") {
		const output = JSON.stringify(data, null, 2) + "\n";
		const flushed = process.stdout.write(output);
		if (!flushed) {
			await new Promise<void>(resolve => process.stdout.once("drain", resolve));
		}
	} else if (format === "table" && Array.isArray(data)) {
		const table = new Table();
		data.forEach(item => table.addRow(item));
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
	.action(async options => {
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
	.action(async options => {
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
			spinner.succeed(`Project "${result.name}" created`);
			console.log(chalk.green(`ID: ${result.id}`));
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
	.action(async options => {
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
	.action(async options => {
		const spinner = createSpinner("Creating task...").start();
		try {
			const tool = getTool("devpad_tasks_upsert");
			if (!tool) throw new Error("Tool not found");

			const client = getApiClient();
			const result = await tool.execute(client, {
				title: options.title,
				project_id: options.project,
				summary: options.summary,
				priority: options.priority.toUpperCase(),
				progress: options.status === "done" ? "DONE" : options.status === "in_progress" ? "IN_PROGRESS" : "TODO",
			});
			spinner.succeed(`Task "${result.title}" created`);
			console.log(chalk.green(`ID: ${result.id}`));
		} catch (error) {
			spinner.fail("Failed to create task");
			handleError(error);
		}
	});

tasks
	.command("done <id>")
	.description("Mark a task as done")
	.action(async id => {
		const spinner = createSpinner("Marking task as done...").start();
		try {
			const tool = getTool("devpad_tasks_upsert");
			if (!tool) throw new Error("Tool not found");

			const client = getApiClient();
			const result = await tool.execute(client, {
				id,
				progress: "DONE",
			});
			spinner.succeed(`Task "${result.title}" marked as done`);
		} catch (error) {
			spinner.fail("Failed to update task");
			handleError(error);
		}
	});

tasks
	.command("todo <id>")
	.description("Mark a task as todo")
	.action(async id => {
		const spinner = createSpinner("Marking task as todo...").start();
		try {
			const tool = getTool("devpad_tasks_upsert");
			if (!tool) throw new Error("Tool not found");

			const client = getApiClient();
			const result = await tool.execute(client, {
				id,
				progress: "TODO",
			});
			spinner.succeed(`Task "${result.title}" marked as todo`);
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
	.action(async options => {
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
	.action(async options => {
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
			spinner.succeed(`Milestone "${result.name}" created`);
			console.log(chalk.green(`ID: ${result.id}`));
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
	.action(async options => {
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
	.action(async options => {
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
			spinner.succeed(`Goal "${result.name}" created`);
			console.log(chalk.green(`ID: ${result.id}`));
		} catch (error) {
			spinner.fail("Failed to create goal");
			handleError(error);
		}
	});

// Tags command group
const tags = program.command("tags").description("Manage tags");

tags.command("list")
	.description("List tags")
	.option("-f, --format <format>", "Output format (json|table)", "json")
	.action(async options => {
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
	.action(async options => {
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

// User command group
const user = program.command("user").description("User preferences and history");

user.command("history")
	.description("Get user activity history")
	.option("-f, --format <format>", "Output format (json|table)", "json")
	.action(async options => {
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

user.command("preferences")
	.description("Update user preferences")
	.requiredOption("-u, --user-id <id>", "User ID")
	.requiredOption("-v, --view <view>", "Task view preference (list|grid)")
	.action(async options => {
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

await program.parseAsync(process.argv);
