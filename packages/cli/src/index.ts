#!/usr/bin/env bun

import { Command } from "commander";
import { ApiClient, getTool } from "@devpad/api";
import chalk from "chalk";
import ora from "ora";
import { Table } from "console-table-printer";

// Helper to get API client
function getApiClient(): ApiClient {
	const apiKey = process.env.DEVPAD_API_KEY || Bun.env.DEVPAD_API_KEY;
	const baseUrl = process.env.DEVPAD_BASE_URL || "https://devpad.tools/api/v0";

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

// Helper to format output
function formatOutput(data: any, format: string = "json") {
	if (format === "json") {
		console.log(JSON.stringify(data, null, 2));
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
		const spinner = ora("Fetching projects...").start();
		try {
			const tool = getTool("devpad_projects_list");
			if (!tool) throw new Error("Tool not found");

			const client = getApiClient();
			const result = await tool.execute(client, { private: options.private });
			spinner.succeed("Projects fetched");
			formatOutput(result, options.format);
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
		const spinner = ora("Fetching project...").start();
		try {
			const tool = getTool("devpad_projects_get");
			if (!tool) throw new Error("Tool not found");

			const client = getApiClient();
			// Try ID first, then name
			const input = idOrName.includes("-") ? { id: idOrName } : { name: idOrName };
			const result = await tool.execute(client, input);
			spinner.succeed("Project fetched");
			formatOutput(result, options.format);
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
		const spinner = ora("Creating project...").start();
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

		const spinner = ora("Deleting project...").start();
		try {
			const tool = getTool("devpad_projects_upsert");
			if (!tool) throw new Error("Tool not found");

			const client = getApiClient();
			await tool.execute(client, { id, deleted: true });
			spinner.succeed("Project deleted");
		} catch (error) {
			spinner.fail("Failed to delete project");
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
		const spinner = ora("Fetching tasks...").start();
		try {
			const tool = getTool("devpad_tasks_list");
			if (!tool) throw new Error("Tool not found");

			const client = getApiClient();
			const result = await tool.execute(client, {
				project_id: options.project,
				tag_id: options.tag,
			});
			spinner.succeed("Tasks fetched");
			formatOutput(result, options.format);
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
		const spinner = ora("Fetching task...").start();
		try {
			const tool = getTool("devpad_tasks_get");
			if (!tool) throw new Error("Tool not found");

			const client = getApiClient();
			const result = await tool.execute(client, { id });
			spinner.succeed("Task fetched");
			formatOutput(result, options.format);
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
		const spinner = ora("Creating task...").start();
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
		const spinner = ora("Marking task as done...").start();
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
		const spinner = ora("Marking task as todo...").start();
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

// Milestones command group
const milestones = program.command("milestones").description("Manage milestones");

milestones
	.command("list")
	.description("List milestones")
	.option("-p, --project <id>", "Filter by project ID")
	.option("-f, --format <format>", "Output format (json|table)", "json")
	.action(async options => {
		const spinner = ora("Fetching milestones...").start();
		try {
			const tool = getTool("devpad_milestones_list");
			if (!tool) throw new Error("Tool not found");

			const client = getApiClient();
			const result = await tool.execute(client, {
				project_id: options.project,
			});
			spinner.succeed("Milestones fetched");
			formatOutput(result, options.format);
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
		const spinner = ora("Creating milestone...").start();
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
		const spinner = ora("Fetching goals...").start();
		try {
			const tool = getTool("devpad_goals_list");
			if (!tool) throw new Error("Tool not found");

			const client = getApiClient();
			const result = await tool.execute(client, {});
			spinner.succeed("Goals fetched");
			formatOutput(result, options.format);
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
		const spinner = ora("Creating goal...").start();
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
		const spinner = ora("Fetching tags...").start();
		try {
			const tool = getTool("devpad_tags_list");
			if (!tool) throw new Error("Tool not found");

			const client = getApiClient();
			const result = await tool.execute(client, {});
			spinner.succeed("Tags fetched");
			formatOutput(result, options.format);
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
		const spinner = ora("Fetching GitHub repositories...").start();
		try {
			const tool = getTool("devpad_github_repos");
			if (!tool) throw new Error("Tool not found");

			const client = getApiClient();
			const result = await tool.execute(client, {});
			spinner.succeed("Repositories fetched");
			formatOutput(result, options.format);
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
		const spinner = ora("Fetching branches...").start();
		try {
			const tool = getTool("devpad_github_branches");
			if (!tool) throw new Error("Tool not found");

			const client = getApiClient();
			const result = await tool.execute(client, { owner, repo });
			spinner.succeed("Branches fetched");
			formatOutput(result, options.format);
		} catch (error) {
			spinner.fail("Failed to fetch branches");
			handleError(error);
		}
	});

// Parse and execute
program.parse(process.argv);
