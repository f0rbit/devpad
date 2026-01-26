#!/usr/bin/env bun

const BLOG_DB_ID = "bfb27257-dc51-46b1-a532-bf4fde3aa117";
const MEDIA_DB_ID = "fee9822f-cc95-422b-bcff-5aad177d5dfb";
const UNIFIED_DB_NAME = "devpad-unified-db";

type Step = { label: string; command: string; note?: string };

const steps: Step[] = [
	{
		label: "Export blog D1 database",
		command: `wrangler d1 export ${BLOG_DB_ID} --output=scripts/blog-export.sql`,
	},
	{
		label: "Export media-timeline D1 database",
		command: `wrangler d1 export ${MEDIA_DB_ID} --output=scripts/media-export.sql`,
	},
	{
		label: "Create unified D1 database (if not exists)",
		command: `wrangler d1 create ${UNIFIED_DB_NAME}`,
		note: "Skip if already created",
	},
	{
		label: "Apply unified schema via drizzle-kit",
		command: `npx drizzle-kit push --dialect=sqlite --driver=d1-http --schema=packages/schema/src/database/unified.ts`,
		note: "Ensure wrangler.toml has correct D1 binding",
	},
	{
		label: "Import devpad data (from local SQLite export)",
		command: `wrangler d1 execute ${UNIFIED_DB_NAME} --file=scripts/migration-output.sql`,
		note: "Run 'bun scripts/migrate-to-d1.ts' first to generate migration-output.sql",
	},
	{
		label: "Filter blog export to data-only (remove CREATE TABLE statements)",
		command: "grep -v '^CREATE TABLE' scripts/blog-export.sql | grep -v '^CREATE INDEX' | grep -v '^CREATE UNIQUE INDEX' > scripts/blog-data-only.sql",
		note: "Schema already exists in unified DB",
	},
	{
		label: "Filter media export to data-only",
		command: "grep -v '^CREATE TABLE' scripts/media-export.sql | grep -v '^CREATE INDEX' | grep -v '^CREATE UNIQUE INDEX' > scripts/media-data-only.sql",
		note: "Schema already exists in unified DB",
	},
	{
		label: "Import blog data into unified DB",
		command: `wrangler d1 execute ${UNIFIED_DB_NAME} --file=scripts/blog-data-only.sql`,
	},
	{
		label: "Import media data into unified DB",
		command: `wrangler d1 execute ${UNIFIED_DB_NAME} --file=scripts/media-data-only.sql`,
	},
];

const format_step = (step: Step, index: number): string => {
	const lines = [`# Step ${index + 1}: ${step.label}`, ...(step.note ? [`# NOTE: ${step.note}`] : []), step.command, ""];
	return lines.join("\n");
};

const output = [
	"#!/bin/bash",
	"set -euo pipefail",
	"",
	"# D1 Database Merge Script",
	"# ========================",
	"# Merges devpad (SQLite), blog (D1), and media-timeline (D1) into unified D1.",
	"#",
	"# Prerequisites:",
	"#   1. wrangler CLI authenticated",
	"#   2. bun scripts/migrate-to-d1.ts already run (generates migration-output.sql)",
	"#",
	"# Run each step manually or uncomment to execute sequentially.",
	"",
	...steps.map((step, i) => format_step(step, i)),
].join("\n");

console.log(output);
