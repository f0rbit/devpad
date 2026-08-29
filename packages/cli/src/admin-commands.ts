/**
 * @module @devpad/cli/admin-commands
 *
 * v2.4 (task A5.3) — `devpad admin verify-fold`: the fold's dual-read
 * verification verb. Goes through the shared tool registry (`getTool`) so
 * CLI, MCP, and ApiClient all consume the same one registration. Exits
 * non-zero on any detected divergence — the verifier's ship-gate for Arc B
 * depends on a clean (exit 0) run against both staging and production.
 */

import { type ApiClient, getTool } from "@devpad/api";
import type { Command } from "commander";
import { fail_with, make_spinner } from "./printer.js";

type ClientFactory = () => ApiClient;
type FoldVerifyReport = { milestone_count: number; goal_count: number; diffs: unknown[]; clean: boolean };
type ReconcileCssReport = { scanned: number; reconciled: string[] };

async function print_json(data: unknown): Promise<void> {
	const output = JSON.stringify(data, null, 2) + "\n";
	const flushed = process.stdout.write(output);
	if (!flushed) await new Promise<void>((resolve) => process.stdout.once("drain", resolve));
}

export function register_admin_commands(program: Command, get_client: ClientFactory): void {
	const admin = program.command("admin").description("Ops/diagnostic commands");

	admin
		.command("verify-fold")
		.description("Dual-read compare the frozen milestone/goal tables against their task-row projections")
		.option("--json", "Output the full report as JSON (default)")
		.action(async () => {
			const spinner = make_spinner("Verifying milestone/goal fold...").start();
			const tool = getTool("devpad_admin_verify_fold");
			if (!tool) return fail_with(spinner, "Tool not found: devpad_admin_verify_fold");
			const result = (await tool.execute(get_client(), {})) as FoldVerifyReport;

			if (result.clean) {
				spinner.succeed(
					`Fold verification clean (${String(result.milestone_count)} milestones, ${String(result.goal_count)} goals)`,
				);
				await print_json(result);
				return;
			}

			spinner.fail(`Fold verification found ${String(result.diffs.length)} divergence(s)`);
			await print_json(result);
			process.exit(1);
		});

	admin
		.command("reconcile-docs-css")
		.description("Re-scrub CSS exfil vectors (@import, url()) out of already-stored docs' <style> blocks")
		.action(async () => {
			const spinner = make_spinner("Reconciling stored docs...").start();
			const tool = getTool("devpad_admin_reconcile_docs_css");
			if (!tool) return fail_with(spinner, "Tool not found: devpad_admin_reconcile_docs_css");
			const result = (await tool.execute(get_client(), {})) as ReconcileCssReport;

			spinner.succeed(`Scanned ${String(result.scanned)} doc(s), reconciled ${String(result.reconciled.length)}`);
			await print_json(result);
		});
}
