/**
 * @module @devpad/cli/reviews-commands
 *
 * v2.4 (task A4.6) — `devpad reviews pending`, the human's queue: one typed
 * aggregate across pending signoffs, open blocking annotation threads,
 * pending pipeline manual gates, and pending scanner diffs.
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

export function register_reviews_commands(program: Command, get_client: ClientFactory): void {
	const reviews = program.command("reviews").description("The human's queue (task A4.6)");

	reviews
		.command("pending")
		.description(
			"Everything waiting on a human: pending signoffs, open blocking annotation threads, pending pipeline gates, pending scanner diffs",
		)
		.action(async () => {
			const spinner = make_spinner("Fetching pending reviews...").start();
			const tool = getTool("devpad_reviews_pending");
			if (!tool) return fail_with(spinner, "Tool not found: devpad_reviews_pending");
			const result = await tool.execute(get_client(), {});
			spinner.succeed("Pending reviews fetched");
			await print_json(result);
		});
}
