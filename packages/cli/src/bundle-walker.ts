/**
 * @module @devpad/cli/bundle-walker
 *
 * Walks a directory-bundle Worker (`dist/_worker.js/` style) and yields
 * a {@link WalkedBundle} of per-file parts ready for upload to corpus.
 *
 * Each walked part carries:
 *  - `name`: forward-slash path relative to the bundle root, doubling as
 *    the multipart form-field name on the CF `versions.upload` wire.
 *  - `mime_type`: derived from the file extension and constrained to the
 *    Worker-module subset (ES module / CommonJS / wasm). Files outside
 *    that subset are rejected — a Worker bundle should only carry JS or
 *    WASM modules.
 *  - `bytes`: raw bytes read into memory. Bundles are <50 MB in practice
 *    (DO memory limit is 128 MB); streaming is a future-only concern.
 *
 * Pure functions in here are side-effect free; the entry-point
 * {@link walk_bundle_dir} is the only function that touches the filesystem.
 */

import { type Dirent, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { err, ok, type Result } from "@f0rbit/corpus";

export type WorkerModuleMimeType = "application/javascript+module" | "application/javascript" | "application/wasm";

export interface WalkedModulePart {
	name: string;
	mime_type: WorkerModuleMimeType;
	bytes: Uint8Array;
	size_bytes: number;
}

export interface WalkedBundle {
	parts: WalkedModulePart[];
	total_size_bytes: number;
}

export type BundleWalkError =
	| { kind: "not_a_directory"; path: string }
	| { kind: "io_error"; path: string; reason: string }
	| { kind: "unsupported_extension"; path: string; extension: string }
	| { kind: "empty_bundle"; path: string };

/**
 * Map a file extension to the Worker-module MIME type CF expects on the
 * `Content-Type` header of each multipart form part.
 *
 * Returns `null` for unsupported extensions. Callers map that to the
 * `unsupported_extension` error so the walk fails fast — a Worker bundle
 * must not carry arbitrary file types (assets belong in `--assets-dir`).
 */
export const mime_for_module_extension = (ext: string): WorkerModuleMimeType | null => {
	switch (ext) {
		case ".mjs":
		case ".js":
			return "application/javascript+module";
		case ".cjs":
			return "application/javascript";
		case ".wasm":
			return "application/wasm";
		default:
			return null;
	}
};

const list_files_recursive = (root: string): Result<string[], BundleWalkError> => {
	const out: string[] = [];
	const stack: string[] = [root];
	while (stack.length > 0) {
		const dir = stack.pop()!;
		let entries: Dirent[] = [];
		try {
			entries = readdirSync(dir, { withFileTypes: true }) as Dirent[];
		} catch (e) {
			return err({ kind: "io_error", path: dir, reason: e instanceof Error ? e.message : String(e) });
		}
		for (const entry of entries) {
			const full = join(dir, String(entry.name));
			if (entry.isSymbolicLink()) continue;
			if (entry.isDirectory()) {
				stack.push(full);
				continue;
			}
			if (entry.isFile()) out.push(full);
		}
	}
	out.sort();
	return ok(out);
};

const extension_of = (path: string): string => {
	const idx = path.lastIndexOf(".");
	if (idx <= 0) return "";
	const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf(sep));
	if (idx < slash) return "";
	return path.slice(idx);
};

const to_posix = (p: string): string => (sep === "/" ? p : p.split(sep).join("/"));

/**
 * Walk a directory-bundle Worker. Returns a list of module parts sorted
 * by their bundle-relative name (deterministic ordering for stable corpus
 * hashes on identical inputs).
 *
 * Failure modes:
 *  - `not_a_directory`: the path doesn't exist or isn't a directory.
 *  - `io_error`: `readdirSync` / `readFileSync` threw.
 *  - `unsupported_extension`: a file with an extension that isn't `.js`,
 *    `.mjs`, `.cjs`, or `.wasm` was encountered.
 *  - `empty_bundle`: the directory has no module files (likely a build
 *    misconfiguration; fail fast rather than upload an empty manifest).
 */
export const walk_bundle_dir = (bundle_dir: string): Result<WalkedBundle, BundleWalkError> => {
	let st: ReturnType<typeof statSync>;
	try {
		st = statSync(bundle_dir);
	} catch (e) {
		return err({ kind: "not_a_directory", path: bundle_dir });
	}
	if (!st.isDirectory()) {
		return err({ kind: "not_a_directory", path: bundle_dir });
	}

	const files = list_files_recursive(bundle_dir);
	if (!files.ok) return files;

	const parts: WalkedModulePart[] = [];
	let total = 0;

	for (const absolute of files.value) {
		const ext = extension_of(absolute);
		const mime = mime_for_module_extension(ext);
		if (mime === null) {
			return err({ kind: "unsupported_extension", path: absolute, extension: ext });
		}
		let bytes: Buffer;
		try {
			bytes = readFileSync(absolute);
		} catch (e) {
			return err({ kind: "io_error", path: absolute, reason: e instanceof Error ? e.message : String(e) });
		}
		const u8 = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		const name = to_posix(relative(bundle_dir, absolute));
		parts.push({ name, mime_type: mime, bytes: u8, size_bytes: u8.byteLength });
		total += u8.byteLength;
	}

	if (parts.length === 0) {
		return err({ kind: "empty_bundle", path: bundle_dir });
	}

	return ok({ parts, total_size_bytes: total });
};
