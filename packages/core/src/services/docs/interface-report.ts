/**
 * @module core/services/docs/interface-report
 *
 * v2.4 (task A4.4) — interface report v1 (architecture-decisions): collect a
 * package's declaration output, normalize it deterministically, and
 * classify a diff as additive-vs-breaking with a lexical (not semantic)
 * comparison. Conservative by design — over-flags breaking, never
 * under-flags — upgradeable behind the same two functions later.
 *
 * Pure — no filesystem, no `tsc` invocation, no network. The CLI
 * (`interface-commands.ts`) owns collecting `.d.ts` files off disk and
 * calling the doc-store/signoff APIs; this module only transforms strings.
 */

import type { InterfaceDiffClass } from "@devpad/schema/validation";

export type { InterfaceDiffClass };

export type DeclarationFile = { path: string; content: string };

const BLOCK_COMMENT_RE = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT_RE = /\/\/.*$/gm;

function strip_comments(content: string): string {
	return content.replace(BLOCK_COMMENT_RE, "").replace(LINE_COMMENT_RE, "");
}

function canonical_line(line: string): string {
	return line.trim().replace(/\s+/g, " ");
}

/**
 * Deterministic, machine-independent normalization: strips comments and
 * blank lines, canonicalizes whitespace, and orders files by path (never by
 * filesystem traversal order, which can vary between machines/runs).
 * Callers must pass paths RELATIVE to the package root — an absolute
 * filesystem path or an embedded timestamp would make the result
 * machine-dependent, defeating the whole point of hash-comparing it later.
 */
export function normalize_declarations(files: DeclarationFile[]): string {
	const sorted = files.toSorted((a, b) => a.path.localeCompare(b.path));
	const sections = sorted.map((file: DeclarationFile) => {
		const lines = strip_comments(file.content)
			.split("\n")
			.map(canonical_line)
			.filter((line) => line.length > 0);
		return [`// file: ${file.path}`, ...lines].join("\n");
	});
	return sections.join("\n\n");
}

/**
 * Lexical, line-based diff classifier. `old` is classified as additive
 * against `new` when every line of `old` still appears in `new`, in the
 * same relative order (a subsequence check) — i.e. only insertions
 * happened. Any removal, modification, or reordering of an existing line
 * fails the subsequence check and classifies `breaking`. Deliberately does
 * NOT understand TypeScript syntax (no semantic analysis) — a purely
 * additive-looking rename would still classify breaking, which is the
 * conservative direction the architecture decision calls for.
 */
export function classify_diff(old_text: string, new_text: string): InterfaceDiffClass {
	if (old_text === new_text) return "unchanged";

	const old_lines = old_text.split("\n");
	const new_lines = new_text.split("\n");

	let cursor = 0;
	for (const line of new_lines) {
		if (cursor < old_lines.length && line === old_lines[cursor]) cursor++;
	}
	return cursor === old_lines.length ? "additive" : "breaking";
}
