#!/usr/bin/env bun

import { Database } from "bun:sqlite";

const sqlite = new Database(":memory:");

const SCHEMA_FILES = {
	devpad: "packages/schema/src/database/schema.ts",
	blog: "packages/schema/src/database/blog.ts",
	media: "packages/schema/src/database/media.ts",
};

const UNIFIED_SCHEMA = "packages/schema/src/database/unified.ts";

const header = [
	"-- Unified devpad Schema for Cloudflare D1",
	`-- Generated: ${new Date().toISOString()}`,
	"--",
	"-- This file documents the schema generation approach.",
	"-- The actual schema is defined in Drizzle ORM and should be pushed using drizzle-kit.",
	"--",
	"-- Schema sources:",
	...Object.entries(SCHEMA_FILES).map(([name, path]) => `--   ${name}: ${path}`),
	"--",
	"-- Unified schema entry: " + UNIFIED_SCHEMA,
	"",
	"-- ================================================",
	"-- RECOMMENDED: Use drizzle-kit to push schema to D1",
	"-- ================================================",
	"--",
	"-- Option 1: Push directly to D1 (requires wrangler auth)",
	"--   npx drizzle-kit push --dialect=sqlite --driver=d1-http \\",
	"--     --schema=packages/schema/src/database/unified.ts",
	"--",
	"-- Option 2: Generate migration SQL files",
	"--   npx drizzle-kit generate --dialect=sqlite \\",
	"--     --schema=packages/schema/src/database/unified.ts \\",
	"--     --out=migrations/d1",
	"--   wrangler d1 migrations apply devpad-unified-db --local",
	"--",
	"-- Option 3: Introspect existing local DB for reference",
	"--   npx drizzle-kit introspect --dialect=sqlite --url=database/local.db",
	"",
];

console.log(header.join("\n"));

const extractSchemaSQL = (): void => {
	try {
		const result = sqlite.query("SELECT sql FROM sqlite_master WHERE type='table' ORDER BY name").all() as { sql: string }[];
		if (result.length > 0) {
			console.log("-- Existing tables in memory DB (if any):");
			for (const { sql: ddl } of result) {
				if (ddl) console.log(`${ddl};\n`);
			}
		}
	} catch {
		// no tables - expected for fresh in-memory DB
	}
};

extractSchemaSQL();

console.log("-- To see the full schema, run:");
console.log("--   sqlite3 database/local.db '.schema'");
console.log("-- Or:");
console.log("--   bun scripts/verify-migration.ts database/local.db");
