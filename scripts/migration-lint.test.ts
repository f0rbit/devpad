import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	check_breakpoints,
	check_journal_when,
	check_pairing,
	check_pragma_foreign_keys,
	check_rebuild_parking,
	check_snapshots,
	lint_dir,
	parse_journal,
	split_statements,
	split_violations,
	type JournalEntry,
	type SqlFile,
	type Violation,
} from "./migration-lint";

const journal_entry = (idx: number, when: number, tag: string): JournalEntry => ({ idx, when, tag });

const sql_file = (name: string, text: string, has_snapshot = true): SqlFile => ({
	name,
	text,
	has_snapshot,
});

const of_rule = (violations: Violation[], rule: string): Violation[] => violations.filter((v) => v.rule === rule);

const write_fixture = (files: Record<string, string>): string => {
	const dir = mkdtempSync(join(tmpdir(), "migration-lint-test-"));
	for (const [name, content] of Object.entries(files)) {
		const path = join(dir, name);
		mkdirSync(join(path, ".."), { recursive: true });
		writeFileSync(path, content);
	}
	return dir;
};

describe("rule: journal_pairing", () => {
	test("flags a journal entry whose sql file is missing", () => {
		const violations = check_pairing(
			[journal_entry(0, 100, "0000_a"), journal_entry(1, 200, "0001_missing_one")],
			[sql_file("0000_a.sql", "CREATE TABLE t (id text);")],
		);
		expect(of_rule(violations, "journal_pairing")).toHaveLength(1);
		expect(violations[0].file).toBe("0001_missing_one.sql");
	});

	test("flags a sql file with no journal entry", () => {
		const violations = check_pairing(
			[journal_entry(0, 100, "0000_a")],
			[sql_file("0000_a.sql", "CREATE TABLE t (id text);"), sql_file("0001_orphan.sql", "SELECT 1;")],
		);
		expect(of_rule(violations, "journal_pairing")).toHaveLength(1);
		expect(violations[0].file).toBe("0001_orphan.sql");
	});

	test("flags idx mismatch between journal entry and filename prefix", () => {
		const violations = check_pairing(
			[journal_entry(0, 100, "0001_a")],
			[sql_file("0001_a.sql", "CREATE TABLE t (id text);")],
		);
		expect(of_rule(violations, "journal_pairing")).toHaveLength(1);
		expect(violations[0].message).toContain("does not match the filename prefix");
	});

	test("flags non-contiguous journal idx", () => {
		const violations = check_pairing(
			[journal_entry(0, 100, "0000_a"), journal_entry(2, 200, "0002_c")],
			[sql_file("0000_a.sql", "SELECT 1;"), sql_file("0002_c.sql", "SELECT 2;")],
		);
		expect(of_rule(violations, "journal_pairing")).toHaveLength(1);
		expect(violations[0].message).toContain("not contiguous");
	});
});

describe("rule: journal_when", () => {
	test("flags a when older than its predecessor (the real 0003 drift)", () => {
		// 0002 when = Sep 2025, 0003 was hand-written with a Jan 2025 timestamp.
		const violations = check_journal_when([
			journal_entry(0, 1737865058086, "0000_a"),
			journal_entry(1, 1756417414428, "0001_b"),
			journal_entry(2, 1756892923113, "0002_c"),
			journal_entry(3, 1738108800000, "0003_hand_written"),
		]);
		expect(of_rule(violations, "journal_when")).toHaveLength(1);
		expect(violations[0].file).toBe("0003_hand_written.sql");
		expect(violations[0].severity).toBe("error");
	});

	test("flags an equal when timestamp", () => {
		const violations = check_journal_when([journal_entry(0, 1000, "0000_a"), journal_entry(1, 1000, "0001_b")]);
		expect(of_rule(violations, "journal_when")).toHaveLength(1);
	});

	test("accepts strictly increasing when by idx", () => {
		const violations = check_journal_when([
			journal_entry(0, 1000, "0000_a"),
			journal_entry(1, 2000, "0001_b"),
			journal_entry(2, 3000, "0002_c"),
		]);
		expect(violations).toHaveLength(0);
	});
});

describe("rule: statement_breakpoint", () => {
	// The exact shape 0026_oidc_trust_repo_ids.sql originally shipped with
	// (per AGENTS.md): two ALTERs, no --> statement-breakpoint — only the
	// first ALTER ever ran in tests.
	const BROKEN_0026 = [
		"-- #171: GitHub Actions immutable-subject support",
		"-- Hand-written ALTER migration: hand-written ALTERs don't produce a",
		"-- paired drizzle snapshot.",
		"ALTER TABLE `pipeline_oidc_trust` ADD `repository_id` text;",
		"ALTER TABLE `pipeline_oidc_trust` ADD `repository_owner_id` text;",
	].join("\n");

	test("reproduces 0026's missing breakpoint against an in-memory fixture", () => {
		const violations = check_breakpoints(sql_file("0026_oidc_trust_repo_ids.sql", BROKEN_0026));
		expect(violations).toHaveLength(1);
		expect(violations[0].rule).toBe("statement_breakpoint");
		expect(violations[0].severity).toBe("error");
		expect(violations[0].message).toContain("2 SQL statements");
	});

	test("flags only the segment missing its marker", () => {
		const text = [
			"CREATE TABLE a (id text);",
			"--> statement-breakpoint",
			"CREATE TABLE b (id text);",
			"--> statement-breakpoint",
			"CREATE TABLE c (id text);",
			"CREATE TABLE d (id text);",
		].join("\n");
		const violations = check_breakpoints(sql_file("0009_x.sql", text));
		expect(violations).toHaveLength(1);
		expect(violations[0].message).toContain("chunk 3/3");
	});

	test("accepts statements separated by markers", () => {
		const text = [
			"CREATE TABLE a (id text);",
			"--> statement-breakpoint",
			"CREATE TABLE b (id text);",
			"--> statement-breakpoint",
			"CREATE TABLE c (id text);",
		].join("\n");
		expect(check_breakpoints(sql_file("0009_x.sql", text))).toHaveLength(0);
	});

	test("single statement needs no marker", () => {
		expect(check_breakpoints(sql_file("0024_x.sql", "ALTER TABLE t ADD c text;"))).toHaveLength(0);
	});

	test("semicolons inside string literals do not count as statement boundaries", () => {
		const text = "INSERT INTO t VALUES ('a;b');--> statement-breakpoint\nSELECT 'x;y';";
		expect(check_breakpoints(sql_file("0009_x.sql", text))).toHaveLength(0);
	});

	test("trigger bodies with inner semicolons stay one statement", () => {
		const text = [
			"CREATE TRIGGER tr AFTER INSERT ON t BEGIN",
			"INSERT INTO log VALUES ('one');",
			"INSERT INTO log VALUES ('two');",
			"END;",
		].join("\n");
		expect(check_breakpoints(sql_file("0009_x.sql", text))).toHaveLength(0);
	});
});

describe("rule: pragma_foreign_keys", () => {
	test("flags PRAGMA foreign_keys=OFF", () => {
		const violations = check_pragma_foreign_keys([
			sql_file("0009_x.sql", "PRAGMA foreign_keys=OFF;\nALTER TABLE t ADD c text;"),
		]);
		expect(violations).toHaveLength(1);
		expect(violations[0].severity).toBe("error");
		expect(violations[0].message).toContain("silently ignored by D1");
	});

	test("accepts defer_foreign_keys (the 0023 pattern)", () => {
		const violations = check_pragma_foreign_keys([
			sql_file("0023_x.sql", "PRAGMA defer_foreign_keys = on;\n--> statement-breakpoint\nALTER TABLE t ADD c text;"),
		]);
		expect(violations).toHaveLength(0);
	});

	test("flags spacing and case variants", () => {
		const violations = check_pragma_foreign_keys([sql_file("0009_x.sql", "pragma   foreign_keys  =  off;")]);
		expect(violations).toHaveLength(1);
	});
});

describe("rule: rebuild_fk_parking", () => {
	// chain: 0000 creates parent + child (child FK-references parent);
	// 0001 rebuilds parent via the drizzle __new_ rename shape.
	const PARENT_CHILD =
		"CREATE TABLE `parent` (id text);--> statement-breakpoint\nCREATE TABLE `child` (parent_id text, FOREIGN KEY (parent_id) REFERENCES `parent`(id));";
	const REBUILD_NO_PARK = [
		"CREATE TABLE `__new_parent` (id text);--> statement-breakpoint",
		"DROP TABLE `parent`;--> statement-breakpoint",
		"ALTER TABLE `__new_parent` RENAME TO `parent`;",
	].join("\n");
	const REBUILD_PARKED = [
		"CREATE TABLE `__tmp_child` AS SELECT * FROM `child`;--> statement-breakpoint",
		"DROP TABLE `child`;--> statement-breakpoint",
		"CREATE TABLE `__new_parent` (id text);--> statement-breakpoint",
		"DROP TABLE `parent`;--> statement-breakpoint",
		"ALTER TABLE `__new_parent` RENAME TO `parent`;--> statement-breakpoint",
		"CREATE TABLE `child` (parent_id text, FOREIGN KEY (parent_id) REFERENCES `parent`(id));--> statement-breakpoint",
		"INSERT INTO `child` SELECT * FROM `__tmp_child`;--> statement-breakpoint",
		"DROP TABLE `__tmp_child`;",
	].join("\n");

	test("flags a rebuild of an FK-referenced table without the park-children pattern", () => {
		const violations = check_rebuild_parking([
			sql_file("0000_base.sql", PARENT_CHILD),
			sql_file("0001_rebuild.sql", REBUILD_NO_PARK),
		]);
		expect(violations).toHaveLength(1);
		expect(violations[0].rule).toBe("rebuild_fk_parking");
		expect(violations[0].severity).toBe("warn");
		expect(violations[0].message).toContain("`parent`");
		expect(violations[0].message).toContain("`child`");
	});

	test("accepts a rebuild with the park-children pattern (0023 shape)", () => {
		const violations = check_rebuild_parking([
			sql_file("0000_base.sql", PARENT_CHILD),
			sql_file("0001_rebuild.sql", REBUILD_PARKED),
		]);
		expect(violations).toHaveLength(0);
	});

	test("ignores a rebuild of a table nothing references", () => {
		const violations = check_rebuild_parking([
			sql_file("0000_base.sql", "CREATE TABLE `lonely` (id text);"),
			sql_file("0001_rebuild.sql", REBUILD_NO_PARK),
		]);
		expect(violations).toHaveLength(0);
	});

	test("detects the api_keys_new rename shape", () => {
		const violations = check_rebuild_parking([
			sql_file("0000_base.sql", PARENT_CHILD),
			sql_file(
				"0001_rebuild.sql",
				[
					"CREATE TABLE `parent_new` (id text);--> statement-breakpoint",
					"DROP TABLE `parent`;--> statement-breakpoint",
					"ALTER TABLE `parent_new` RENAME TO `parent`;",
				].join("\n"),
			),
		]);
		expect(violations).toHaveLength(1);
	});
});

describe("rule: snapshot_pairing", () => {
	test("warns for a historical migration without a snapshot", () => {
		const violations = check_snapshots(
			[journal_entry(0, 100, "0000_a"), journal_entry(1, 200, "0001_b")],
			[sql_file("0000_a.sql", "SELECT 1;", false), sql_file("0001_b.sql", "SELECT 2;", true)],
		);
		expect(violations).toHaveLength(1);
		expect(violations[0].rule).toBe("snapshot_pairing");
		expect(violations[0].severity).toBe("warn");
		expect(violations[0].file).toBe("0000_a.sql");
	});

	test("errors when the latest migration lacks its snapshot", () => {
		const violations = check_snapshots(
			[journal_entry(0, 100, "0000_a"), journal_entry(1, 200, "0001_b")],
			[sql_file("0000_a.sql", "SELECT 1;", true), sql_file("0001_b.sql", "SELECT 2;", false)],
		);
		expect(violations).toHaveLength(1);
		expect(violations[0].severity).toBe("error");
	});

	test("accepts all snapshots present", () => {
		const violations = check_snapshots([journal_entry(0, 100, "0000_a")], [sql_file("0000_a.sql", "SELECT 1;", true)]);
		expect(violations).toHaveLength(0);
	});
});

describe("split_statements", () => {
	test("ignores line comments and quoted regions when splitting", () => {
		const text = [
			"-- a comment with a semicolon; inside",
			"INSERT INTO t VALUES ('a;b');--> statement-breakpoint",
			/* block comment ; */ "SELECT `weird;name` FROM t;",
		].join("\n");
		const statements = split_statements(text);
		expect(statements).toHaveLength(2);
		expect(statements[1].sql).toBe("SELECT `weird;name` FROM t");
	});

	test("reports each statement's starting line for diagnostics", () => {
		const text = "CREATE TABLE a (\n\tid text\n);--> statement-breakpoint\nSELECT 1;";
		const statements = split_statements(text);
		expect(statements).toHaveLength(2);
		expect(statements[0].line).toBe(1);
		expect(statements[1].line).toBe(4);
	});
});

describe("parse_journal", () => {
	test("accepts a well-formed journal", () => {
		const raw: unknown = { entries: [{ idx: 0, when: 100, tag: "0000_a", version: "6", breakpoints: true }] };
		const result = parse_journal(raw);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toEqual([journal_entry(0, 100, "0000_a")]);
	});

	test("rejects a malformed journal", () => {
		const result = parse_journal({ entries: [{ idx: "zero", when: 100, tag: "a" }] });
		expect(result.ok).toBe(false);
	});
});

describe("split_violations (allowlist)", () => {
	test("moves allowlisted rule:file keys to grandfathered", () => {
		const out = split_violations([
			{ rule: "snapshot_pairing", severity: "warn", file: "0007_add_pulse_scope.sql", message: "m" },
			{ rule: "statement_breakpoint", severity: "error", file: "0099_new.sql", message: "m" },
		]);
		expect(out.grandfathered).toHaveLength(1);
		expect(out.blocked).toHaveLength(1);
		expect(out.blocked[0].rule).toBe("statement_breakpoint");
	});

	test("keeps violations from unlisted files blocked", () => {
		const out = split_violations([
			{ rule: "rebuild_fk_parking", severity: "warn", file: "0099_new_rebuild.sql", message: "m" },
		]);
		expect(out.grandfathered).toHaveLength(0);
		expect(out.blocked).toHaveLength(1);
	});
});

describe("lint_dir (fs integration)", () => {
	let temp_dir = "";

	afterEach(() => {
		if (temp_dir.length > 0) {
			rmSync(temp_dir, { recursive: true, force: true });
			temp_dir = "";
		}
	});

	const JOURNAL = JSON.stringify({
		version: "6",
		dialect: "sqlite",
		entries: [
			{ idx: 0, version: "6", when: 1000, tag: "0000_a", breakpoints: true },
			{ idx: 1, version: "6", when: 2000, tag: "0001_b", breakpoints: true },
		],
	});

	test("lints a clean fixture directory end to end", () => {
		temp_dir = write_fixture({
			"meta/_journal.json": JOURNAL,
			"meta/0000_snapshot.json": "{}",
			"meta/0001_snapshot.json": "{}",
			"0000_a.sql": "CREATE TABLE t (id text);--> statement-breakpoint\nCREATE TABLE u (id text);",
			"0001_b.sql": "ALTER TABLE t ADD c text;",
		});
		const result = lint_dir(temp_dir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.blocked).toEqual([]);
			expect(result.value.grandfathered).toEqual([]);
		}
	});

	test("surfaces breakpoint + snapshot errors from a fixture directory", () => {
		temp_dir = write_fixture({
			"meta/_journal.json": JOURNAL,
			"meta/0000_snapshot.json": "{}",
			"0000_a.sql": "CREATE TABLE t (id text);",
			"0001_b.sql": "ALTER TABLE t ADD c text;\nALTER TABLE t ADD d text;",
		});
		const result = lint_dir(temp_dir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			const rules = result.value.blocked.map((v) => v.rule).toSorted();
			expect(rules).toEqual(["snapshot_pairing", "statement_breakpoint"]);
		}
	});

	test("returns a typed error for a missing directory", () => {
		const result = lint_dir(join(tmpdir(), "migration-lint-does-not-exist"));
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.kind).toBe("unreadable_dir");
	});

	test("returns a typed error for a missing journal file", () => {
		temp_dir = write_fixture({
			"0000_a.sql": "SELECT 1;",
		});
		const result = lint_dir(temp_dir);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.kind).toBe("bad_journal");
	});
});
