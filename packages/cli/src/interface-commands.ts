/**
 * @module @devpad/cli/interface-commands
 *
 * v2.4 (task A4.4) — `devpad interface push|check`, the CLI surface for the
 * interface report. `push` collects a package's declaration output,
 * normalizes it, and submits it — the server independently recomputes the
 * additive-vs-breaking classification and auto-approves additive diffs
 * against an approved base. `check` regenerates locally and hash-compares
 * against the approved base without pushing anything — the verb the
 * verifier runs at gate time (Apollo pattern: approval as CI assertion).
 */

import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { type ApiClient, getTool } from "@devpad/api";
import { type DeclarationFile, normalize_declarations } from "@devpad/core/services/docs";
import { compute_hash } from "@f0rbit/corpus";
import type { Command } from "commander";
import { z } from "zod";
import { fail_with, make_spinner } from "./printer.js";

const interface_status_response = z.object({
	document_id: z.string().nullable(),
	approved_content_hash: z.string().nullable(),
});

type ClientFactory = () => ApiClient;

async function print_json(data: unknown): Promise<void> {
	const output = JSON.stringify(data, null, 2) + "\n";
	const flushed = process.stdout.write(output);
	if (!flushed) await new Promise<void>((resolve) => process.stdout.once("drain", resolve));
}

export type InterfaceContent = { title: string; html: string };

/** Pure — normalizes the collected declaration files under `package_name` as the doc title. */
export function build_interface_content(files: DeclarationFile[], package_name: string): InterfaceContent {
	return { title: package_name, html: normalize_declarations(files) };
}

/**
 * Replicates `@f0rbit/corpus`'s `json_codec` content-hash exactly
 * (`compute_hash(TextEncoder().encode(JSON.stringify(value)))`) so `check`
 * can compare against the server's stored `content_hash` without an extra
 * round-trip through corpus itself.
 */
export async function compute_local_hash(content: InterfaceContent): Promise<string> {
	return compute_hash(new TextEncoder().encode(JSON.stringify(content)));
}

/** Pure — the `check` verb's pass/fail decision. No approved base at all is a failure (nothing to be in sync with). */
export function interface_check_exit_code(local_hash: string, approved_hash: string | null): 0 | 1 {
	return approved_hash !== null && local_hash === approved_hash ? 0 : 1;
}

function collect_dts_files(dir: string, root: string): DeclarationFile[] {
	const out: DeclarationFile[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...collect_dts_files(full, root));
			continue;
		}
		if (entry.name.endsWith(".d.ts")) {
			out.push({ path: path.relative(root, full), content: readFileSync(full, "utf-8") });
		}
	}
	return out;
}

/** `dist/**\/*.d.ts` if it exists (the package has already been built); otherwise a throwaway `tsc --emitDeclarationOnly` run. */
function collect_declaration_files(package_dir: string): DeclarationFile[] {
	const dist_dir = path.join(package_dir, "dist");
	if (existsSync(dist_dir)) return collect_dts_files(dist_dir, dist_dir);

	const tmp_dir = mkdtempSync(path.join(tmpdir(), "devpad-interface-"));
	execSync(`bunx tsc --emitDeclarationOnly --outDir ${tmp_dir}`, { cwd: package_dir, stdio: "pipe" });
	return collect_dts_files(tmp_dir, tmp_dir);
}

const package_json_name = z.object({ name: z.string().optional() });

function resolve_package_name(package_dir: string): string {
	const raw = readFileSync(path.join(package_dir, "package.json"), "utf-8");
	const parsed = package_json_name.parse(JSON.parse(raw));
	return parsed.name ?? path.basename(package_dir);
}

export function register_interface_commands(program: Command, get_client: ClientFactory): void {
	const iface = program
		.command("interface")
		.description("Interface report — additive/breaking classification (task A4.4)");

	iface
		.command("push")
		.description("Push the package's declaration output as a new interface-doc version")
		.requiredOption("--package <dir>", "Package directory")
		.requiredOption("-p, --project <id>", "Project ID")
		.option("-t, --task <id>", "Task to attach")
		.option(
			"--document <id>",
			"Push a new version onto this existing interface document instead of finding one by name",
		)
		.action(async (options: { package: string; project: string; task?: string; document?: string }) => {
			const spinner = make_spinner("Collecting declarations...").start();
			let files: DeclarationFile[];
			let package_name: string;
			try {
				files = collect_declaration_files(options.package);
				package_name = resolve_package_name(options.package);
			} catch (e) {
				return fail_with(spinner, `Failed to collect declarations: ${e instanceof Error ? e.message : String(e)}`);
			}
			const content = build_interface_content(files, package_name);

			let document_id = options.document;
			if (!document_id) {
				const listed = await get_client().docs.list({ project_id: options.project, task_id: options.task });
				if (!listed.ok) return fail_with(spinner, `Failed to list documents: ${listed.error.message}`);
				document_id = listed.value.find((d) => d.kind === "interface" && d.title === package_name)?.id;
			}

			const tool = getTool("devpad_interface_push");
			if (!tool) return fail_with(spinner, "Tool not found: devpad_interface_push");
			const result = await tool.execute(get_client(), {
				document_id,
				project_id: options.project,
				task_id: options.task,
				title: content.title,
				normalized: content.html,
			});
			spinner.succeed("Interface report pushed");
			await print_json(result);
		});

	iface
		.command("check")
		.description("Regenerate declarations locally and hash-compare against the approved base — exits 1 on drift")
		.requiredOption("--package <dir>", "Package directory")
		.requiredOption("-p, --project <id>", "Project ID")
		.option("-t, --task <id>", "Task the interface doc is attached to")
		.action(async (options: { package: string; project: string; task?: string }) => {
			const spinner = make_spinner("Checking interface report...").start();
			let files: DeclarationFile[];
			let package_name: string;
			try {
				files = collect_declaration_files(options.package);
				package_name = resolve_package_name(options.package);
			} catch (e) {
				return fail_with(spinner, `Failed to collect declarations: ${e instanceof Error ? e.message : String(e)}`);
			}
			const content = build_interface_content(files, package_name);
			const local_hash = await compute_local_hash(content);

			const tool = getTool("devpad_interface_status");
			if (!tool) return fail_with(spinner, "Tool not found: devpad_interface_status");
			const raw_status = await tool.execute(get_client(), {
				project_id: options.project,
				task_id: options.task,
				title: package_name,
			});
			const status = interface_status_response.parse(raw_status);

			const exit_code = interface_check_exit_code(local_hash, status.approved_content_hash);
			if (exit_code === 0) {
				spinner.succeed("Interface report matches the approved base");
			} else {
				spinner.fail("Interface report has drifted from the approved base");
			}
			await print_json({ local_hash, approved_content_hash: status.approved_content_hash, exit_code });
			process.exit(exit_code);
		});
}
