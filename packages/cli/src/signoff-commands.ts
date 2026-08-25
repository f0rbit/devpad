/**
 * @module @devpad/cli/signoff-commands
 *
 * v2.4 (task A4.3) — `devpad signoffs request|get|decide`, the CLI surface
 * for the generalized human-approval ledger. `decide` is human-only — an
 * api-channel key gets 403, same as the route.
 */

import { type ApiClient, getTool } from "@devpad/api";
import type { Command } from "commander";
import { fail_with, make_spinner } from "./printer.js";

type ClientFactory = () => ApiClient;

async function print_json(data: unknown): Promise<void> {
	const output = JSON.stringify(data, null, 2) + "\n";
	const flushed = process.stdout.write(output);
	if (!flushed) await new Promise<void>((resolve) => process.stdout.once("drain", resolve));
}

export function register_signoff_commands(program: Command, get_client: ClientFactory): void {
	const signoffs = program.command("signoffs").description("Human-approval checkpoints (task A4.3)");

	signoffs
		.command("request")
		.description("Request a signoff checkpoint — creates a pending approval node")
		.requiredOption("-p, --project <id>", "Project ID")
		.requiredOption("-k, --kind <kind>", "doc_version | stage | pipeline_gate")
		.requiredOption("-s, --subject <id>", "Subject ID (document ID, stage name, or pipeline gate ID)")
		.requiredOption("-c, --checkpoint <checkpoint>", "plan | types | design")
		.option("-b, --blocks <ids...>", "Downstream task IDs this checkpoint blocks", [])
		.action(
			async (options: { project: string; kind: string; subject: string; checkpoint: string; blocks: string[] }) => {
				const spinner = make_spinner("Requesting checkpoint...").start();
				const tool = getTool("devpad_signoffs_request");
				if (!tool) return fail_with(spinner, "Tool not found: devpad_signoffs_request");
				const result = await tool.execute(get_client(), {
					project_id: options.project,
					subject_kind: options.kind,
					subject_id: options.subject,
					checkpoint: options.checkpoint,
					blocks: options.blocks,
				});
				spinner.succeed("Checkpoint requested");
				await print_json(result);
			},
		);

	signoffs
		.command("get <id>")
		.description("Get a signoff checkpoint's current state")
		.action(async (id: string) => {
			const spinner = make_spinner("Fetching signoff...").start();
			const tool = getTool("devpad_signoffs_get");
			if (!tool) return fail_with(spinner, "Tool not found: devpad_signoffs_get");
			const result = await tool.execute(get_client(), { id });
			spinner.succeed("Signoff fetched");
			await print_json(result);
		});

	signoffs
		.command("decide <id> <decision>")
		.description("Decide a signoff checkpoint (approved | changes_requested) — human-only")
		.option("-r, --reason <reason>", "Reason for the decision")
		.action(async (id: string, decision: string, options: { reason?: string }) => {
			const spinner = make_spinner("Recording decision...").start();
			const tool = getTool("devpad_signoffs_decide");
			if (!tool) return fail_with(spinner, "Tool not found: devpad_signoffs_decide");
			const result = await tool.execute(get_client(), { id, decision, reason: options.reason });
			spinner.succeed("Decision recorded");
			await print_json(result);
		});
}
