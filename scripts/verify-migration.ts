#!/usr/bin/env bun

import { Database } from "bun:sqlite";

const DEVPAD_TABLES = [
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

const BLOG_TABLES = ["users", "blog_posts", "blog_categories", "blog_tags", "access_keys", "blog_integrations", "blog_fetch_links", "blog_post_projects"] as const;

const MEDIA_TABLES = ["media_users", "media_profiles", "media_accounts", "media_api_keys", "media_rate_limits", "media_account_settings", "media_profile_filters", "media_platform_credentials", "corpus_snapshots"] as const;

type TableCount = { table: string; count: number; error?: string };

const countTable = (db: Database, table: string): TableCount => {
	try {
		const row = db.query(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number };
		return { table, count: row.count };
	} catch (e) {
		return { table, count: 0, error: e instanceof Error ? e.message : "unknown" };
	}
};

const printSection = (label: string, counts: TableCount[]): number => {
	console.log(`\n${label}`);
	console.log("=".repeat(40));

	let section_total = 0;
	for (const { table, count, error } of counts) {
		if (error) {
			console.log(`  ${table.padEnd(28)} ERROR: ${error}`);
			continue;
		}
		console.log(`  ${table.padEnd(28)} ${count}`);
		section_total += count;
	}
	console.log(`  ${"SUBTOTAL".padEnd(28)} ${section_total}`);
	return section_total;
};

const source_path = process.argv[2] || "database/local.db";
console.log(`Source database: ${source_path}`);

const db = new Database(source_path, { readonly: true });

const devpad_counts = DEVPAD_TABLES.map(t => countTable(db, t));
const blog_counts = BLOG_TABLES.map(t => countTable(db, t));
const media_counts = MEDIA_TABLES.map(t => countTable(db, t));

const devpad_total = printSection("devpad Tables", devpad_counts);
const blog_total = printSection("Blog Tables", blog_counts);
const media_total = printSection("Media Tables", media_counts);

console.log(`\n${"GRAND TOTAL".padEnd(30)} ${devpad_total + blog_total + media_total}`);

console.log("\nTo verify D1 counts, run:");
console.log("  wrangler d1 execute devpad-unified-db --command=\"SELECT 'user' as t, COUNT(*) as c FROM user\"");

db.close();
