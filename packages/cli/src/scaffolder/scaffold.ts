/**
 * @module @devpad/cli/scaffolder/scaffold
 *
 * Side-effect orchestrator for `devpad pipelines init`. Reads templates
 * from disk, hands them to the pure render layer, writes the rendered
 * files into the target directory, and (optionally) runs `git init` and
 * `bun install`.
 *
 * Every error is a typed `Result.err`. The only `try` in this module is
 * the corpus-wrapped fs/exec boundaries.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { derive_template_vars, render_template, SCAFFOLDER_TEMPLATES, type ScaffolderInput, type TemplateEntry, type TemplateVars, validate_package_name } from "@devpad/pipeline-templates";
import { err, format_error, ok, type Result, try_catch_async } from "@f0rbit/corpus";
import type { ScaffoldedPackage, ScaffolderError, ScaffoldRequest } from "./types.ts";

const TEMPLATES_PACKAGE_ROOT = path.resolve(import.meta.dir, "..", "..", "..", "pipeline-templates", "src", "scaffolder", "templates");

/**
 * Locate the templates directory on disk. Resolved against
 * `pipeline-templates`'s source tree so both `bun run` and the bundled
 * CLI binary find templates without relying on `require.resolve` shims.
 */
export const resolve_templates_root = (override?: string): string => override ?? TEMPLATES_PACKAGE_ROOT;

const ensure_dir = async (dir: string): Promise<Result<void, ScaffolderError>> => {
	const r = await try_catch_async(
		() => mkdir(dir, { recursive: true }),
		e => ({ code: "write_failed" as const, message: format_error(e), path: dir })
	);
	if (!r.ok) return r;
	return ok(undefined);
};

const read_template_file = async (templates_root: string, entry: TemplateEntry): Promise<Result<string, ScaffolderError>> => {
	const full_path = path.join(templates_root, entry.template_path);
	return try_catch_async(
		() => readFile(full_path, "utf8"),
		e => ({
			code: "template_read_failed" as const,
			message: `failed to read template "${entry.template_path}": ${format_error(e)}`,
			template: entry.template_path,
		})
	);
};

const write_file_atomic = async (target_path: string, contents: string): Promise<Result<void, ScaffolderError>> => {
	const dir_result = await ensure_dir(path.dirname(target_path));
	if (!dir_result.ok) return dir_result;
	const r = await try_catch_async(
		() => writeFile(target_path, contents, "utf8"),
		e => ({ code: "write_failed" as const, message: format_error(e), path: target_path })
	);
	if (!r.ok) return r;
	return ok(undefined);
};

const render_one = (entry: TemplateEntry, source: string, vars: TemplateVars): Result<string, ScaffolderError> => {
	const render_result = render_template(source, vars as unknown as Record<string, string>);
	if (!render_result.ok) {
		return err({
			code: "render_failed",
			message: `failed to render template "${entry.template_path}": ${render_result.error.message}`,
			template: entry.template_path,
			cause: render_result.error,
		});
	}
	return ok(render_result.value);
};

const render_and_write_one = async (templates_root: string, target_dir: string, entry: TemplateEntry, vars: TemplateVars): Promise<Result<string, ScaffolderError>> => {
	const source_result = await read_template_file(templates_root, entry);
	if (!source_result.ok) return source_result;
	const rendered_result = render_one(entry, source_result.value, vars);
	if (!rendered_result.ok) return rendered_result;
	const target_path = path.join(target_dir, entry.relative_path);
	const write_result = await write_file_atomic(target_path, rendered_result.value);
	if (!write_result.ok) return write_result;
	return ok(entry.relative_path);
};

const run_command = async (command: string, args: string[], cwd: string): Promise<Result<void, { message: string; code: number | null }>> => {
	return new Promise(resolve => {
		const proc = spawn(command, args, { cwd, stdio: "ignore" });
		proc.on("error", e => resolve(err({ message: format_error(e), code: null })));
		proc.on("close", code => {
			if (code === 0) return resolve(ok(undefined));
			resolve(err({ message: `${command} exited with code ${code}`, code }));
		});
	});
};

const run_git_init = async (cwd: string): Promise<Result<void, ScaffolderError>> => {
	const r = await run_command("git", ["init", "--initial-branch=main"], cwd);
	if (!r.ok) return err({ code: "git_init_failed", message: r.error.message });
	return ok(undefined);
};

const run_bun_install = async (cwd: string): Promise<Result<void, ScaffolderError>> => {
	const r = await run_command("bun", ["install"], cwd);
	if (!r.ok) return err({ code: "install_failed", message: r.error.message });
	return ok(undefined);
};

export type ScaffoldOptions = {
	/** Override the templates directory; useful for the golden test. */
	templates_root?: string;
	/** Override the captured "now" for deterministic `compatibility_date`. */
	now?: Date;
};

/**
 * Generate a pipeline-managed package at `request.target_dir`. Renders
 * every {@link SCAFFOLDER_TEMPLATES} entry, writes them, optionally runs
 * `git init` and `bun install`. Fails fast on the first error and never
 * partially "completes" — but it does NOT roll back already-written
 * files; the CLI surfaces that to the user.
 */
export const scaffold_package = async (request: ScaffoldRequest, options: ScaffoldOptions = {}): Promise<Result<ScaffoldedPackage, ScaffolderError>> => {
	const validation = validate_package_name(request.package_name);
	if (!validation.ok) {
		return err({
			code: "validation_failed",
			message: validation.error.message,
			cause: validation.error,
		});
	}

	if (existsSync(request.target_dir)) {
		return err({
			code: "target_exists",
			message: `target directory already exists: ${request.target_dir}`,
			target_dir: request.target_dir,
		});
	}

	const input: ScaffolderInput = {
		package_name: request.package_name,
		rollout: request.rollout,
		default_gate: request.default_gate,
		build_shape: request.build_shape,
		now: options.now ?? new Date(),
	};
	const vars = derive_template_vars(input);

	const templates_root = resolve_templates_root(options.templates_root);

	const target_create = await ensure_dir(request.target_dir);
	if (!target_create.ok) return target_create;

	const files_written: string[] = [];
	for (const entry of SCAFFOLDER_TEMPLATES) {
		const r = await render_and_write_one(templates_root, request.target_dir, entry, vars);
		if (!r.ok) return r;
		files_written.push(r.value);
	}

	const git_initialised = request.skip_git !== true ? (await run_git_init(request.target_dir)).ok : false;
	const deps_installed = request.skip_install !== true ? (await run_bun_install(request.target_dir)).ok : false;

	return ok({
		package_name: request.package_name,
		target_dir: request.target_dir,
		files_written,
		git_initialised,
		deps_installed,
	});
};

/** Re-export so tests can import everything from one place. */
export { SCAFFOLDER_TEMPLATES } from "@devpad/pipeline-templates";
