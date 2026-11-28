/**
 * Deterministic linter for the D1 migration set under
 * `packages/schema/src/database/drizzle`, enforcing the invariants
 * documented in AGENTS.md ("Drizzle-kit + manual migrations"):
 *
 * - journal/file pairing (tag <-> filename, idx <-> numeric prefix, contiguous idx)
 * - journal `when` strictly increasing by idx (drizzle skips non-newer entries)
 * - one SQL statement per `--> statement-breakpoint` chunk (the migrator runs
 *   each chunk as ONE statement; 0026 shipped without a marker and only its
 *   first ALTER ran)
 * - no `PRAGMA foreign_keys=OFF` (D1 ignores it) — the park-children rebuild
 *   pattern is the documented alternative
 * - table rebuilds (DROP TABLE x + `ALTER TABLE __new_x RENAME TO x`) of
 *   FK-referenced tables must park their children. Best-effort heuristic: the
 *   FK graph is built from the WHOLE migration chain, so a child created by a
 *   later migration (which did not exist at rebuild time) can over-flag.
 *   Over-flags are warn-severity and grandfatherable via ALLOWLIST.
 * - snapshot pairing: missing `meta/<idx>_snapshot.json` warns for historical
 *   hand-written migrations and errors for the latest one
 *
 * Rules are pure functions over an in-memory model (journal entries + sql
 * files); `lint_dir` is the only IO shell. Tests drive the pure core with
 * fixtures; `bun scripts/migration-lint.ts` runs against the real directory
 * and exits non-zero on any error-severity violation.
 */
import { err, ok, type Result } from "@f0rbit/corpus";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type ViolationSeverity = "error" | "warn";

export type Violation = {
	rule: string;
	severity: ViolationSeverity;
	file: string;
	message: string;
};

export type LintError = { kind: "unreadable_dir" | "bad_journal"; message: string };

export type JournalEntry = { idx: number; when: number; tag: string };

export type SqlFile = { name: string; text: string; has_snapshot: boolean };

export type LintOutcome = { blocked: Violation[]; grandfathered: Violation[] };

const BREAKPOINT_MARKER = "--> statement-breakpoint";
const NAME_PATTERN = /^(\d{4})_(.+)\.sql$/;

const pad4 = (idx: number): string => String(idx).padStart(4, "0");

/**
 * Violations grandfathered as genuinely historical drift. Key is
 * `${rule}:${file}`; value is the reason shown in the CLI output.
 */
const ALLOWLIST: Record<string, string> = {
	"snapshot_pairing:0007_add_pulse_scope.sql":
		"hand-written journal-only migration (pulse scope rollout) — never had a drizzle snapshot",
	"rebuild_fk_parking:0001_thick_lady_deathstrike.sql":
		"pre-convention rebuild of `project` — children referenced it without the park-children pattern; applied to production long ago",
	"rebuild_fk_parking:0002_sticky_lockjaw.sql":
		"pre-convention rebuild of `task` — children referenced it without the park-children pattern; applied to production long ago",
};

const is_grandfathered = (v: Violation): boolean => `${v.rule}:${v.file}` in ALLOWLIST;

export const split_violations = (violations: Violation[]): LintOutcome => ({
	blocked: violations.filter((v) => !is_grandfathered(v)),
	grandfathered: violations.filter(is_grandfathered),
});

export const parse_filename = (name: string): { idx: number; tag: string } | null => {
	const match = NAME_PATTERN.exec(name);
	if (!match) return null;
	return { idx: Number.parseInt(match[1], 10), tag: name.slice(0, -".sql".length) };
};

const is_object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const is_journal_entry = (value: unknown): value is JournalEntry =>
	is_object(value) &&
	typeof value.idx === "number" &&
	Number.isInteger(value.idx) &&
	typeof value.when === "number" &&
	typeof value.tag === "string" &&
	value.tag.length > 0;

export const parse_journal = (raw: unknown): Result<JournalEntry[], LintError> => {
	if (!is_object(raw)) return err({ kind: "bad_journal", message: "journal is not an object" });
	const entries = raw.entries;
	if (!Array.isArray(entries)) return err({ kind: "bad_journal", message: "journal.entries is not a list" });
	const parsed: JournalEntry[] = [];
	for (const entry of entries) {
		if (!is_journal_entry(entry))
			return err({
				kind: "bad_journal",
				message: "journal.entries contains a malformed migration entry (need integer idx, number when, non-empty tag)",
			});
		parsed.push({ idx: entry.idx, when: entry.when, tag: entry.tag });
	}
	return ok(parsed);
};

const count_newlines = (text: string, from: number, to: number): number => {
	let n = 0;
	for (let i = from; i < to && i < text.length; i += 1) if (text[i] === "\n") n += 1;
	return n;
};

const skip_quoted = (text: string, start: number, close: string): number => {
	let i = start + 1;
	while (i < text.length) {
		if (text.startsWith(close + close, i)) {
			i += 2;
			continue;
		}
		if (text.startsWith(close, i)) return i + 1;
		i += 1;
	}
	return text.length;
};

/**
 * Splits SQL text into statements the way SQLite would see them: on `;` at
 * top level, ignoring line/block comments and quoted regions. Trigger bodies
 * are handled best-effort: a CREATE TRIGGER statement only terminates after
 * an `END;` (semicolons inside the body do not split).
 */
export const split_statements = (text: string): Array<{ sql: string; line: number }> => {
	const statements: Array<{ sql: string; line: number }> = [];
	let current = "";
	let start_line = -1;
	let line = 1;
	let last_word = "";
	let trigger_mode = false;
	let i = 0;

	const push = (): void => {
		const trimmed = current.trim();
		if (trimmed.length > 0) statements.push({ sql: trimmed, line: start_line < 0 ? line : start_line });
		current = "";
		start_line = -1;
		trigger_mode = false;
		last_word = "";
	};
	const note_content = (): void => {
		if (start_line < 0) start_line = line;
	};

	while (i < text.length) {
		const ch = text[i];
		if (ch === "\n") {
			line += 1;
			i += 1;
			continue;
		}
		if (ch === "-" && text[i + 1] === "-") {
			const next = text.indexOf("\n", i);
			const end = next === -1 ? text.length : next;
			line += count_newlines(text, i, end);
			i = end;
			continue;
		}
		if (ch === "/" && text[i + 1] === "*") {
			const end = text.indexOf("*/", i + 2);
			const upto = end === -1 ? text.length : end + 2;
			line += count_newlines(text, i, upto);
			i = upto;
			continue;
		}
		if (ch === "'" || ch === '"' || ch === "`") {
			const end = skip_quoted(text, i, ch);
			line += count_newlines(text, i, end);
			note_content();
			current += text.slice(i, Math.min(end, text.length));
			i = end;
			continue;
		}
		if (ch === "[") {
			const end = skip_quoted(text, i, "]");
			line += count_newlines(text, i, end);
			note_content();
			current += text.slice(i, Math.min(end, text.length));
			i = end;
			continue;
		}
		if (ch === ";") {
			if (trigger_mode && last_word.toUpperCase() !== "END") {
				current += ch;
				i += 1;
				continue;
			}
			push();
			i += 1;
			continue;
		}
		if (/[A-Za-z0-9_]/.test(ch)) {
			let j = i;
			while (j < text.length && /[A-Za-z0-9_]/.test(text[j])) j += 1;
			const word = text.slice(i, j);
			if (word.toUpperCase() === "TRIGGER" && /create(\s+temp(orary)?)?$/i.test(current.trim())) trigger_mode = true;
			last_word = word;
			note_content();
			current += word;
			i = j;
			continue;
		}
		note_content();
		current += ch;
		i += 1;
	}
	push();
	return statements;
};

export const check_pairing = (entries: JournalEntry[], files: SqlFile[]): Violation[] => {
	const violations: Violation[] = [];
	const seen_tags = new Map<string, number>();
	for (const e of entries) {
		const prev = seen_tags.get(e.tag);
		if (prev !== undefined)
			violations.push({
				rule: "journal_pairing",
				severity: "error",
				file: "",
				message: `journal tag "${e.tag}" appears at both idx ${String(prev)} and idx ${String(e.idx)}`,
			});
		seen_tags.set(e.tag, e.idx);
	}
	const idxs = entries.map((e) => e.idx).toSorted((a, b) => a - b);
	for (const [position, idx] of idxs.entries()) {
		if (idx !== position) {
			violations.push({
				rule: "journal_pairing",
				severity: "error",
				file: "",
				message: `journal idx values are not contiguous from 0 (position ${String(position)} holds idx ${String(idx)})`,
			});
			break;
		}
	}
	for (const file of files) {
		const parsed = parse_filename(file.name);
		if (!parsed) {
			violations.push({
				rule: "journal_pairing",
				severity: "error",
				file: file.name,
				message: 'filename does not match "<idx>_<tag>.sql" (4-digit zero-padded idx)',
			});
			continue;
		}
		const match = entries.find((e) => e.tag === parsed.tag);
		if (!match) {
			violations.push({
				rule: "journal_pairing",
				severity: "error",
				file: file.name,
				message: "sql file has no journal entry with a matching tag",
			});
			continue;
		}
		if (match.idx !== parsed.idx)
			violations.push({
				rule: "journal_pairing",
				severity: "error",
				file: file.name,
				message: `journal idx ${String(match.idx)} does not match the filename prefix ${String(parsed.idx)}`,
			});
	}
	for (const e of entries) {
		const has_file = files.some((f) => parse_filename(f.name)?.tag === e.tag);
		if (!has_file)
			violations.push({
				rule: "journal_pairing",
				severity: "error",
				file: `${e.tag}.sql`,
				message: "journal entry has no matching .sql file",
			});
	}
	return violations;
};

export const check_journal_when = (entries: JournalEntry[]): Violation[] => {
	const sorted = entries.toSorted((a, b) => a.idx - b.idx);
	const violations: Violation[] = [];
	for (let i = 1; i < sorted.length; i += 1) {
		const prev = sorted[i - 1];
		const cur = sorted[i];
		if (cur.when <= prev.when)
			violations.push({
				rule: "journal_when",
				severity: "error",
				file: `${cur.tag}.sql`,
				message: `journal "when" (${String(cur.when)}) is not strictly greater than idx ${String(prev.idx)}'s (${String(prev.when)}) — drizzle silently skips any migration whose when is not newer than the last applied one`,
			});
	}
	return violations;
};

export const check_breakpoints = (file: SqlFile): Violation[] => {
	const segments = file.text.split(BREAKPOINT_MARKER);
	const violations: Violation[] = [];
	for (const [position, segment] of segments.entries()) {
		const statements = split_statements(segment);
		if (statements.length <= 1) continue;
		const lines = statements.map((st) => st.line).join(", ");
		violations.push({
			rule: "statement_breakpoint",
			severity: "error",
			file: file.name,
			message: `chunk ${String(position + 1)}/${String(segments.length)} holds ${String(statements.length)} SQL statements (lines ${lines}) but the migrator runs each --> statement-breakpoint chunk as ONE statement — put --> statement-breakpoint between every pair of statements`,
		});
	}
	return violations;
};

const FOREIGN_KEYS_OFF = /pragma\s+foreign_keys\s*=\s*off/i;

export const check_pragma_foreign_keys = (files: SqlFile[]): Violation[] =>
	files.flatMap((file) =>
		split_statements(file.text)
			.filter((st) => FOREIGN_KEYS_OFF.test(st.sql))
			.map(
				(st): Violation => ({
					rule: "pragma_foreign_keys",
					severity: "error",
					file: file.name,
					message: `line ${String(st.line)}: PRAGMA foreign_keys=OFF is silently ignored by D1 — use the park-children rebuild pattern documented in AGENTS.md instead`,
				}),
			),
	);

type Rebuild = { table: string; handled: Set<string> };

const RENAME_PATTERN = /alter\s+table\s+[`"[]?([A-Za-z0-9_]+)[`"\]]?\s+rename\s+to\s+[`"[]?([A-Za-z0-9_]+)/gi;
const DROP_PATTERN = /drop\s+table\s+(?:if\s+exists\s+)?[`"[]?([A-Za-z0-9_]+)/gi;
const CREATE_TABLE_PATTERN = /create\s+table\s+(?:if\s+not\s+exists\s+)?[`"[]?([A-Za-z0-9_]+)/i;
const REFERENCES_PATTERN = /references\s+[`"[]?([A-Za-z0-9_]+)/gi;

const rebuilt_tables = (file: SqlFile): Rebuild[] => {
	const statements = split_statements(file.text).map((st) => st.sql);
	const dropped = new Set<string>();
	for (const sql of statements) for (const match of sql.matchAll(DROP_PATTERN)) dropped.add(match[1].toLowerCase());
	const rebuilds: Rebuild[] = [];
	for (const sql of statements) {
		for (const match of sql.matchAll(RENAME_PATTERN)) {
			const from = match[1].toLowerCase();
			const to = match[2].toLowerCase();
			const is_rebuild_shape = from === `__new_${to}` || from === `${to}_new`;
			if (!is_rebuild_shape || !dropped.has(to)) continue;
			rebuilds.push({ table: to, handled: dropped });
		}
	}
	return rebuilds;
};

const fk_graph = (files: SqlFile[]): Map<string, Set<string>> => {
	const graph = new Map<string, Set<string>>();
	for (const file of files) {
		for (const st of split_statements(file.text)) {
			const table_match = CREATE_TABLE_PATTERN.exec(st.sql);
			if (!table_match) continue;
			const child = table_match[1].toLowerCase();
			for (const ref of st.sql.matchAll(REFERENCES_PATTERN)) {
				const parent = ref[1].toLowerCase();
				if (parent === child) continue;
				const parents = graph.get(child) ?? new Set<string>();
				parents.add(parent);
				graph.set(child, parents);
			}
		}
	}
	return graph;
};

export const check_rebuild_parking = (files: SqlFile[]): Violation[] => {
	const graph = fk_graph(files);
	const violations: Violation[] = [];
	for (const file of files) {
		for (const rebuild of rebuilt_tables(file)) {
			const children = [...graph.entries()]
				.filter(([child, parents]) => child !== rebuild.table && parents.has(rebuild.table))
				.map(([child]) => child);
			for (const child of children) {
				if (rebuild.handled.has(child)) continue;
				violations.push({
					rule: "rebuild_fk_parking",
					severity: "warn",
					file: file.name,
					message: `rebuilds \`${rebuild.table}\` (DROP TABLE + rename) while \`${child}\` still carries a FOREIGN KEY referencing it and is neither dropped nor parked (CREATE TABLE \`__tmp_${child}\` AS SELECT * FROM \`${child}\` first) — see the park-children pattern in AGENTS.md. Best-effort heuristic: a child created by a later migration did not reference the table at rebuild time and may be a false positive.`,
				});
			}
		}
	}
	return violations;
};

export const check_snapshots = (entries: JournalEntry[], files: SqlFile[]): Violation[] => {
	const latest_idx = Math.max(...entries.map((e) => e.idx), -1);
	return files.flatMap((file): Violation[] => {
		const parsed = parse_filename(file.name);
		if (!parsed || file.has_snapshot) return [];
		const is_latest = parsed.idx === latest_idx;
		return [
			{
				rule: "snapshot_pairing",
				severity: is_latest ? "error" : "warn",
				file: file.name,
				message: is_latest
					? `the latest migration has no meta/${pad4(parsed.idx)}_snapshot.json — the snapshot chain must be reconciled (bunx drizzle-kit generate) before the next schema change`
					: `no meta/${pad4(parsed.idx)}_snapshot.json — hand-written ALTERs historically ship journal-only; run bunx drizzle-kit generate after the next schema change to reconcile`,
			},
		];
	});
};

export const lint_migrations = (entries: JournalEntry[], files: SqlFile[]): Violation[] => [
	...check_pairing(entries, files),
	...check_journal_when(entries),
	...files.flatMap(check_breakpoints),
	...check_pragma_foreign_keys(files),
	...check_rebuild_parking(files),
	...check_snapshots(entries, files),
];

export const lint_dir = (dir: string): Result<LintOutcome, LintError> => {
	if (!existsSync(dir)) return err({ kind: "unreadable_dir", message: `migrations directory not found: ${dir}` });
	const journal_path = join(dir, "meta", "_journal.json");
	if (!existsSync(journal_path)) return err({ kind: "bad_journal", message: `journal not found: ${journal_path}` });
	const raw: unknown = JSON.parse(readFileSync(journal_path, "utf8"));
	const entries = parse_journal(raw);
	if (!entries.ok) return err(entries.error);
	const files: SqlFile[] = readdirSync(dir)
		.filter((name) => name.endsWith(".sql"))
		.toSorted()
		.map((name) => {
			const idx = parse_filename(name)?.idx ?? -1;
			return {
				name,
				text: readFileSync(join(dir, name), "utf8"),
				has_snapshot: existsSync(join(dir, "meta", `${pad4(idx)}_snapshot.json`)),
			};
		});
	return ok(split_violations(lint_migrations(entries.value, files)));
};

const print_violation = (v: Violation, label: string): void => {
	process.stdout.write(`${label} ${v.rule} ${v.file}: ${v.message}\n`);
};

export const run_cli = (dir: string): number => {
	const result = lint_dir(dir);
	if (!result.ok) {
		process.stderr.write(`migration-lint: ${result.error.message}\n`);
		return 2;
	}
	const { blocked, grandfathered } = result.value;
	process.stdout.write(`migration-lint: ${dir}\n`);
	for (const v of blocked) print_violation(v, v.severity === "error" ? "ERROR" : "WARN  ");
	for (const v of grandfathered) print_violation(v, "GRANDFATHERED");
	const errors = blocked.filter((v) => v.severity === "error");
	if (errors.length > 0) {
		process.stdout.write(`migration-lint: ${String(errors.length)} error(s)\n`);
		return 1;
	}
	process.stdout.write(
		`migration-lint: clean (${String(blocked.length)} warning(s), ${String(grandfathered.length)} grandfathered)\n`,
	);
	return 0;
};

const MIGRATIONS_DIR = join(import.meta.dir, "..", "packages", "schema", "src", "database", "drizzle");

if (import.meta.main) process.exit(run_cli(MIGRATIONS_DIR));
