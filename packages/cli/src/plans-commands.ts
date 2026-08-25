/**
 * @module @devpad/cli/plans-commands
 *
 * v2.4 (task A4.1) — `devpad plans push|pull|list`, the CLI surface for the
 * corpus-backed doc store. Every action goes through the shared tool
 * registry (`getTool`), same as `graph-commands.ts`.
 */

import { readFileSync } from "node:fs";
import { type ApiClient, getTool } from "@devpad/api";
import type { DocumentKind } from "@devpad/schema";
import type { Command } from "commander";
import { fail_with, make_spinner } from "./printer.js";

type ClientFactory = () => ApiClient;

async function print_json(data: unknown): Promise<void> {
	const output = JSON.stringify(data, null, 2) + "\n";
	const flushed = process.stdout.write(output);
	if (!flushed) await new Promise<void>((resolve) => process.stdout.once("drain", resolve));
}

const DOCUMENT_KINDS: DocumentKind[] = ["plan", "design", "interface"];

function is_document_kind(value: string): value is DocumentKind {
	return (DOCUMENT_KINDS as string[]).includes(value);
}

export function register_plans_commands(program: Command, get_client: ClientFactory): void {
	const plans = program.command("plans").description("Push/pull docs to the corpus-backed doc store");

	plans
		.command("push <file>")
		.description("Push an HTML file as a new document, or a new version onto an existing one (--document)")
		.requiredOption("-p, --project <id>", "Project ID")
		.option("-t, --task <id>", "Attach to a task")
		.option("-k, --kind <kind>", "plan | design | interface (default: plan)", "plan")
		.option("--title <title>", "Document title (default: the file name)")
		.option("--document <id>", "Push a new version onto this existing document instead of creating one")
		.action(
			async (
				file: string,
				options: { project: string; task?: string; kind: string; title?: string; document?: string },
			) => {
				const spinner = make_spinner("Pushing document...").start();
				if (!is_document_kind(options.kind)) {
					return fail_with(spinner, `Invalid --kind '${options.kind}' — expected plan | design | interface`);
				}
				let html: string;
				try {
					html = readFileSync(file, "utf-8");
				} catch (e) {
					return fail_with(spinner, `Failed to read ${file}: ${e instanceof Error ? e.message : String(e)}`);
				}

				const tool = getTool("devpad_docs_push");
				if (!tool) return fail_with(spinner, "Tool not found: devpad_docs_push");
				const result = await tool.execute(get_client(), {
					document_id: options.document,
					project_id: options.project,
					task_id: options.task,
					kind: options.kind,
					title: options.title ?? file.split("/").pop() ?? file,
					html,
				});
				spinner.succeed("Document pushed");
				await print_json(result);
			},
		);

	plans
		.command("pull <document_id>")
		.description("Pull a document's content at a specific version (default: head)")
		.option("-v, --version <version>", "Corpus version — defaults to head")
		.option("--annotated", "Include the decoded annotation threads (open + orphaned) alongside the content")
		.action(async (document_id: string, options: { version?: string; annotated?: boolean }) => {
			const spinner = make_spinner("Pulling document...").start();
			const tool = getTool("devpad_docs_pull");
			if (!tool) return fail_with(spinner, "Tool not found: devpad_docs_pull");
			const result = await tool.execute(get_client(), { id: document_id, version: options.version });
			spinner.succeed("Document pulled");
			if (options.annotated || typeof result !== "object" || result === null) {
				await print_json(result);
				return;
			}
			const { threads: _threads, orphaned: _orphaned, ...without_threads } = result as Record<string, unknown>;
			await print_json(without_threads);
		});

	plans
		.command("versions <document_id>")
		.description("Full version history for a document, newest first")
		.action(async (document_id: string) => {
			const spinner = make_spinner("Fetching version history...").start();
			const tool = getTool("devpad_docs_versions");
			if (!tool) return fail_with(spinner, "Tool not found: devpad_docs_versions");
			const result = await tool.execute(get_client(), { id: document_id });
			spinner.succeed("Version history fetched");
			await print_json(result);
		});

	plans
		.command("list")
		.description("List documents for a project")
		.requiredOption("-p, --project <id>", "Project ID")
		.option("-t, --task <id>", "Filter to documents attached to this task")
		.action(async (options: { project: string; task?: string }) => {
			const spinner = make_spinner("Listing documents...").start();
			const tool = getTool("devpad_docs_list");
			if (!tool) return fail_with(spinner, "Tool not found: devpad_docs_list");
			const result = await tool.execute(get_client(), { project_id: options.project, task_id: options.task });
			spinner.succeed("Documents listed");
			await print_json(result);
		});

	const annotations = plans.command("annotations").description("Markers-in-doc annotation threads (task A4.2)");

	annotations
		.command("create <document_id>")
		.description("Open a new annotation thread, anchored to an exact quote")
		.requiredOption("--quote <text>", "The exact text being annotated")
		.requiredOption("--prefix <text>", "~32 chars immediately before the quote")
		.requiredOption("--suffix <text>", "~32 chars immediately after the quote")
		.requiredOption("--start <n>", "Character offset of the quote's start")
		.requiredOption("--end <n>", "Character offset of the quote's end")
		.requiredOption("--body <text>", "The annotation's comment text")
		.option("--blocking", "Mark this thread as blocking approval", false)
		.action(
			async (
				document_id: string,
				options: {
					quote: string;
					prefix: string;
					suffix: string;
					start: string;
					end: string;
					body: string;
					blocking: boolean;
				},
			) => {
				const spinner = make_spinner("Creating annotation thread...").start();
				const tool = getTool("devpad_annotations_create");
				if (!tool) return fail_with(spinner, "Tool not found: devpad_annotations_create");
				const result = await tool.execute(get_client(), {
					document_id,
					quote: options.quote,
					prefix: options.prefix,
					suffix: options.suffix,
					start: Number(options.start),
					end: Number(options.end),
					body: options.body,
					blocking: options.blocking,
				});
				spinner.succeed("Annotation thread created");
				await print_json(result);
			},
		);

	annotations
		.command("reply <document_id> <thread_id>")
		.description("Reply to an annotation thread")
		.requiredOption("--body <text>", "Reply text")
		.action(async (document_id: string, thread_id: string, options: { body: string }) => {
			const spinner = make_spinner("Replying to thread...").start();
			const tool = getTool("devpad_annotations_reply");
			if (!tool) return fail_with(spinner, "Tool not found: devpad_annotations_reply");
			const result = await tool.execute(get_client(), { document_id, thread_id, body: options.body });
			spinner.succeed("Reply added");
			await print_json(result);
		});

	annotations
		.command("resolve <document_id> <thread_id>")
		.description("Mark an annotation thread resolved")
		.action(async (document_id: string, thread_id: string) => {
			const spinner = make_spinner("Resolving thread...").start();
			const tool = getTool("devpad_annotations_resolve");
			if (!tool) return fail_with(spinner, "Tool not found: devpad_annotations_resolve");
			const result = await tool.execute(get_client(), { document_id, thread_id });
			spinner.succeed("Thread resolved");
			await print_json(result);
		});

	annotations
		.command("blocking <document_id> <thread_id> <blocking>")
		.description("Toggle whether an annotation thread blocks approval (blocking: true|false)")
		.action(async (document_id: string, thread_id: string, blocking: string) => {
			const spinner = make_spinner("Updating thread...").start();
			const tool = getTool("devpad_annotations_toggle_blocking");
			if (!tool) return fail_with(spinner, "Tool not found: devpad_annotations_toggle_blocking");
			const result = await tool.execute(get_client(), { document_id, thread_id, blocking: blocking === "true" });
			spinner.succeed("Thread updated");
			await print_json(result);
		});

	annotations
		.option("--unresolved", "List pending annotation threads (anything not resolved)")
		.option("-p, --project <id>", "Project ID")
		.option("-d, --document <id>", "Document ID")
		.action(async (options: { unresolved?: boolean; project?: string; document?: string }) => {
			if (!options.unresolved) {
				annotations.help();
				return;
			}
			const spinner = make_spinner("Fetching unresolved annotation threads...").start();
			const tool = getTool("devpad_annotations_unresolved");
			if (!tool) return fail_with(spinner, "Tool not found: devpad_annotations_unresolved");
			const result = await tool.execute(get_client(), { project_id: options.project, document_id: options.document });
			spinner.succeed("Unresolved threads fetched");
			await print_json(result);
		});
}
