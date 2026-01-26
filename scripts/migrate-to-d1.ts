#!/usr/bin/env bun

import { Database } from "bun:sqlite";
import { generateInserts } from "./utils/sql-escape.ts";

const MIGRATION_ORDER = [
	"user",
	"api_key",
	"project",
	"action",
	"tracker_result",
	"todo_updates",
	"milestone",
	"goal",
	"task",
	"checklist",
	"checklist_item",
	"codebase_tasks",
	"tag",
	"task_tag",
	"commit_detail",
	"tag_config",
	"ignore_path",
] as const;

type MigrationResult = { ok: true; tables_exported: number; total_rows: number } | { ok: false; error: string };

const readTable = (db: Database, table_name: string): Record<string, unknown>[] => {
	try {
		return db.query(`SELECT * FROM ${table_name}`).all() as Record<string, unknown>[];
	} catch {
		return [];
	}
};

const buildTableSection = (table_name: string, inserts: string[]): string[] => {
	if (inserts.length === 0) return [`-- Table: ${table_name} (empty)`, ""];
	return [`-- Table: ${table_name} (${inserts.length} rows)`, ...inserts, ""];
};

const buildOutputSQL = (sections: string[][]): string => {
	const header = ["-- devpad Migration Script", `-- Generated: ${new Date().toISOString()}`, "-- Source: SQLite local database", "", "PRAGMA foreign_keys = OFF;", "", "BEGIN TRANSACTION;", ""];
	const footer = ["COMMIT;", "", "PRAGMA foreign_keys = ON;"];
	return [...header, ...sections.flat(), ...footer].join("\n");
};

const migrate = (source_path: string, output_path: string): MigrationResult => {
	try {
		const db = new Database(source_path, { readonly: true });

		let total_rows = 0;
		let tables_exported = 0;

		const sections = MIGRATION_ORDER.map(table_name => {
			const rows = readTable(db, table_name);
			const inserts = generateInserts(rows, table_name);
			if (inserts.length > 0) tables_exported++;
			total_rows += inserts.length;
			return buildTableSection(table_name, inserts);
		});

		const sql = buildOutputSQL(sections);
		Bun.write(output_path, sql);

		db.close();
		return { ok: true, tables_exported, total_rows };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
};

const source_path = process.argv[2] || "database/local.db";
const output_path = process.argv[3] || "scripts/migration-output.sql";

console.log(`Migrating: ${source_path} -> ${output_path}`);

const result = migrate(source_path, output_path);

if (!result.ok) {
	console.error(`Migration failed: ${result.error}`);
	process.exit(1);
}

console.log(`Migration SQL written to: ${output_path}`);
console.log(`Tables exported: ${result.tables_exported}/${MIGRATION_ORDER.length}`);
console.log(`Total rows: ${result.total_rows}`);
