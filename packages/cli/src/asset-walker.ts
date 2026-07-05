/**
 * @module @devpad/cli/asset-walker
 *
 * Walks a static-asset directory (Astro/Remix-style `dist/` output) and
 * yields the per-file parts required to populate Cloudflare's
 * assets-upload-session manifest plus the corpus blob refs.
 *
 * Hashing matches wrangler 4.x exactly so a CF asset uploaded via this
 * walker and via wrangler resolves to the same key in CF's
 * content-addressed asset store. The algorithm (locked):
 *
 * ```
 * blake3_wasm.hash(base64(bytes) + extension_without_leading_dot)
 *   .toString("hex")
 *   .slice(0, 32)
 * ```
 *
 * `extension_without_leading_dot` is `path.extname(file).slice(1)` — so
 * `index.html` → `"html"`, `app.B2w6jFLc.css` → `"css"`, `Dockerfile` →
 * `""`. Wrangler source ref: `wrangler-dist/cli.js::hashFile`.
 *
 * The ignore policy mirrors wrangler's `createAssetsIgnoreFunction`:
 *  - `/.assetsignore`, `/_redirects`, `/_headers` are always skipped
 *    (these are metafiles, not assets — the orchestrator handles them
 *    out-of-band).
 *  - If `.assetsignore` exists at the root of the assets dir, its lines
 *    are parsed as gitignore-style patterns and applied to all files.
 *  - Additional caller-supplied skip patterns are appended verbatim — the
 *    CLI uses this to skip the Worker bundle directory when it lives
 *    inside the assets dir (`dist/_worker.js/`).
 *
 * Pure functions below are side-effect free; {@link walk_assets_dir} is
 * the only function that touches the filesystem.
 */

import { type Dirent, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { err, ok, type Result } from "@f0rbit/corpus";
import * as blake3 from "blake3-wasm";
import ignore_factory from "ignore";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error — `mime` v3 ships JS-only; we adapt to its
// `Mime.getType(path) → string | null` runtime contract below.
import mime from "mime";

const CF_ASSETS_IGNORE_FILENAME = ".assetsignore";
const REDIRECTS_FILENAME = "_redirects";
const HEADERS_FILENAME = "_headers";

/** 25 MiB — CF Workers Static Assets per-file hard limit. */
export const MAX_ASSET_SIZE = 25 * 1024 * 1024;

export interface WalkedAssetPart {
	/** Posix path with leading "/" — the key CF's manifest expects. */
	path: string;
	/** BLAKE3 hash truncated to first 32 hex chars — the key CF dedups on. */
	hash: string;
	bytes: Uint8Array;
	size_bytes: number;
	/** Resolved MIME type, defaults to `application/octet-stream`. */
	mime_type: string;
}

export interface WalkedAssets {
	parts: WalkedAssetPart[];
	total_size_bytes: number;
}

export type AssetWalkError =
	| { kind: "not_a_directory"; path: string }
	| { kind: "io_error"; path: string; reason: string }
	| { kind: "asset_too_large"; path: string; size_bytes: number; limit_bytes: number };

export interface WalkAssetsOptions {
	/**
	 * Extra ignore patterns appended to the rules read from
	 * `.assetsignore`. Used by the CLI to skip the Worker bundle dir when
	 * it lives inside the assets dir (e.g. `dist/_worker.js/`).
	 */
	extra_ignore_patterns?: string[];
}

/**
 * Compute the CF asset hash for a given file's bytes + extension. Pure.
 *
 * Matches wrangler 4.x byte-for-byte: BLAKE3 hash of
 * `base64(bytes) + extension`, hex-encoded, first 32 chars. The
 * `extension` argument is the raw extension *without* a leading dot
 * (matches `path.extname(p).slice(1)` from wrangler).
 */
export const compute_asset_hash = (bytes: Uint8Array, extension_without_dot: string): string => {
	const base64 = Buffer.from(bytes).toString("base64");
	const digest = blake3.hash(base64 + extension_without_dot).toString("hex");
	return digest.slice(0, 32);
};

/**
 * Resolve a file's MIME type via the `mime` package. Returns
 * `application/octet-stream` for unknown extensions — same fallback CF
 * uses on serve.
 */
export const mime_for_asset = (filepath: string): string => {
	const type = (mime as unknown as { getType: (p: string) => string | null }).getType(filepath);
	return type === null || type === undefined ? "application/octet-stream" : type;
};

const to_posix_relative = (root: string, full: string): string => {
	const rel = relative(root, full);
	const posix = sep === "/" ? rel : rel.split(sep).join("/");
	return `/${posix}`;
};

const list_files_recursive = (root: string): Result<string[], AssetWalkError> => {
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

const read_assetsignore = (assets_dir: string): string[] => {
	const path = join(assets_dir, CF_ASSETS_IGNORE_FILENAME);
	try {
		const contents = readFileSync(path, "utf8");
		return contents.split("\n");
	} catch {
		return [];
	}
};

/**
 * Walk an asset directory, applying wrangler's ignore policy, computing
 * the CF asset hash + MIME type for each file. Returns a list sorted by
 * path (deterministic ordering for stable corpus hashes on identical
 * inputs).
 *
 * Failure modes:
 *  - `not_a_directory`: the path doesn't exist or isn't a directory.
 *  - `io_error`: a `readdirSync`/`readFileSync` threw.
 *  - `asset_too_large`: a file exceeds {@link MAX_ASSET_SIZE} — CF rejects
 *    the upload before we even open the session, so fail fast.
 */
export const walk_assets_dir = (
	assets_dir: string,
	options: WalkAssetsOptions = {},
): Result<WalkedAssets, AssetWalkError> => {
	let st: ReturnType<typeof statSync>;
	try {
		st = statSync(assets_dir);
	} catch (e) {
		return err({ kind: "not_a_directory", path: assets_dir });
	}
	if (!st.isDirectory()) {
		return err({ kind: "not_a_directory", path: assets_dir });
	}

	const ignore_patterns: string[] = [
		`/${CF_ASSETS_IGNORE_FILENAME}`,
		`/${REDIRECTS_FILENAME}`,
		`/${HEADERS_FILENAME}`,
		...read_assetsignore(assets_dir),
		...(options.extra_ignore_patterns ?? []),
	];
	const matcher = ignore_factory().add(ignore_patterns.filter((line) => line.trim().length > 0));

	const files = list_files_recursive(assets_dir);
	if (!files.ok) return files;

	const parts: WalkedAssetPart[] = [];
	let total = 0;
	for (const absolute of files.value) {
		const rel = relative(assets_dir, absolute);
		const rel_posix = sep === "/" ? rel : rel.split(sep).join("/");
		if (matcher.ignores(rel_posix)) continue;

		let bytes: Buffer;
		try {
			bytes = readFileSync(absolute);
		} catch (e) {
			return err({ kind: "io_error", path: absolute, reason: e instanceof Error ? e.message : String(e) });
		}
		if (bytes.byteLength > MAX_ASSET_SIZE) {
			return err({
				kind: "asset_too_large",
				path: absolute,
				size_bytes: bytes.byteLength,
				limit_bytes: MAX_ASSET_SIZE,
			});
		}
		const u8 = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		const extension = extname(absolute).slice(1);
		const hash = compute_asset_hash(u8, extension);
		const part: WalkedAssetPart = {
			path: to_posix_relative(assets_dir, absolute),
			hash,
			bytes: u8,
			size_bytes: u8.byteLength,
			mime_type: mime_for_asset(absolute),
		};
		parts.push(part);
		total += u8.byteLength;
	}

	return ok({ parts, total_size_bytes: total });
};
