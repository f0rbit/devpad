/**
 * @module @devpad/cli/graph-commands
 *
 * v2.4 graph verbs: `devpad ready` (top-level) and `devpad tasks
 * tree|near|claim|link|unlink|apply` (extends the existing `tasks` group).
 * Every action goes through the shared tool registry (`getTool`) so CLI,
 * MCP, and ApiClient all consume the same one registration.
 */

import { type ApiClient, getTool } from "@devpad/api";
import { apply_request } from "@devpad/schema/validation";
import chalk from "chalk";
import type { Command } from "commander";
import { fail_with, make_spinner } from "./printer.js";

type ClientFactory = () => ApiClient;

async function print_json(data: unknown): Promise<void> {
	const output = JSON.stringify(data, null, 2) + "\n";
	const flushed = process.stdout.write(output);
	if (!flushed) await new Promise<void>((resolve) => process.stdout.once("drain", resolve));
}

export function register_graph_commands(program: Command, tasks: Command, get_client: ClientFactory): void {
	program
		.command("ready")
		.description("List tasks ready to work on (not blocked, no incomplete children, start_time passed)")
		.option("-p, --project <id>", "Filter by project ID")
		.option("-l, --limit <n>", "Page size (default 20, max 100)")
		.option("--cursor <cursor>", "Pagination cursor from a previous page's next_cursor")
		.action(async (options) => {
			const spinner = make_spinner("Fetching ready tasks...").start();
			const tool = getTool("devpad_tasks_ready");
			if (!tool) return fail_with(spinner, "Tool not found: devpad_tasks_ready");
			const result = await tool.execute(get_client(), {
				project_id: options.project,
				limit: options.limit ? Number(options.limit) : undefined,
				cursor: options.cursor,
			});
			spinner.succeed("Ready tasks fetched");
			await print_json(result);
		});

	tasks
		.command("tree <id>")
		.description("Get a task and its bounded descendant subtree")
		.option("-d, --depth <n>", "Max hops down (default: GRAPH_DEPTH_CAP)")
		.action(async (id: string, options: { depth?: string }) => {
			const spinner = make_spinner("Fetching task tree...").start();
			const tool = getTool("devpad_tasks_tree");
			if (!tool) return fail_with(spinner, "Tool not found: devpad_tasks_tree");
			const result = await tool.execute(get_client(), { id, depth: options.depth ? Number(options.depth) : undefined });
			spinner.succeed("Task tree fetched");
			await print_json(result);
		});

	tasks
		.command("near <id>")
		.description("Get the depth-2 link neighborhood around a task, including backlinks")
		.action(async (id: string) => {
			const spinner = make_spinner("Fetching task neighborhood...").start();
			const tool = getTool("devpad_tasks_near");
			if (!tool) return fail_with(spinner, "Tool not found: devpad_tasks_near");
			const result = await tool.execute(get_client(), { id });
			spinner.succeed("Task neighborhood fetched");
			await print_json(result);
		});

	tasks
		.command("claim <id>")
		.description("Atomically claim a task for an agent")
		.requiredOption("-a, --actor <actor>", "Identifier for the claiming agent")
		.requiredOption("-r, --base-rev <rev>", "Expected current rev (optimistic concurrency guard)")
		.action(async (id: string, options: { actor: string; baseRev: string }) => {
			const spinner = make_spinner("Claiming task...").start();
			const tool = getTool("devpad_tasks_claim");
			if (!tool) return fail_with(spinner, "Tool not found: devpad_tasks_claim");
			const result = await tool.execute(get_client(), { id, actor: options.actor, base_rev: Number(options.baseRev) });
			spinner.succeed(`Task ${id} claimed by ${options.actor}`);
			await print_json(result);
		});

	tasks
		.command("link")
		.description("Create a typed edge between two tasks")
		.requiredOption("--src <id>", "Source task ID")
		.requiredOption("--dst <id>", "Destination task ID")
		.requiredOption("-k, --kind <kind>", "blocks | relates_to | references | discovered_from | tracks_metric")
		.option("-n, --note <note>", "Optional free-text note")
		.action(async (options: { src: string; dst: string; kind: string; note?: string }) => {
			const spinner = make_spinner("Linking tasks...").start();
			const tool = getTool("devpad_tasks_link");
			if (!tool) return fail_with(spinner, "Tool not found: devpad_tasks_link");
			const result = await tool.execute(get_client(), {
				src_id: options.src,
				dst_id: options.dst,
				kind: options.kind,
				note: options.note,
			});
			spinner.succeed(`Linked ${options.src} ${chalk.dim(options.kind)} ${options.dst}`);
			await print_json(result);
		});

	tasks
		.command("unlink <link_id>")
		.description("Remove a typed edge by its own id")
		.action(async (link_id: string) => {
			const spinner = make_spinner("Removing link...").start();
			const tool = getTool("devpad_tasks_unlink");
			if (!tool) return fail_with(spinner, "Tool not found: devpad_tasks_unlink");
			await tool.execute(get_client(), { id: link_id });
			spinner.succeed(`Link ${link_id} removed`);
		});

	tasks
		.command("apply <request_json>")
		.description("Batch apply graph ops atomically — pass a JSON string: {idempotency_key, ops: [...]}")
		.action(async (request_json: string) => {
			const spinner = make_spinner("Applying batch...").start();
			const tool = getTool("devpad_tasks_apply");
			if (!tool) return fail_with(spinner, "Tool not found: devpad_tasks_apply");

			const parsed = apply_request.safeParse(try_json_parse(request_json));
			if (!parsed.success) return fail_with(spinner, `request_json is invalid: ${parsed.error.message}`);

			const result = await tool.execute(get_client(), parsed.data);
			spinner.succeed("Batch applied");
			await print_json(result);
		});

	tasks
		.command("stage <id> <to>")
		.description(
			"Advance a task's SDLC stage (ideate|plan|build|review|deploy|live). Gated hops 409 naming the missing checkpoint unless --override.",
		)
		.option("--override", "Bypass the gate — always succeeds but is audited")
		.option("-r, --reason <reason>", "Reason for the override")
		.action(async (id: string, to: string, options: { override?: boolean; reason?: string }) => {
			const spinner = make_spinner("Advancing stage...").start();
			const tool = getTool("devpad_tasks_advance_stage");
			if (!tool) return fail_with(spinner, "Tool not found: devpad_tasks_advance_stage");
			const result = await tool.execute(get_client(), { id, to, override: options.override, reason: options.reason });
			spinner.succeed(`Task ${id} advanced to ${to}`);
			await print_json(result);
		});
}

function try_json_parse(text: string): unknown {
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return undefined;
	}
}
