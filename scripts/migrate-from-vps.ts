#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { $ } from "bun";

const HELP = `
devpad VPS to Cloudflare Migration Script

Usage:
  bun scripts/migrate-from-vps.ts <devpad.sqlite> [blog.sqlite] [options]

Arguments:
  devpad.sqlite    Path to the devpad SQLite database file (required)
  blog.sqlite      Path to the blog SQLite database file (optional)

Options:
  --env <env>      Target environment: preview or production (default: preview)
  --dry-run        Print SQL statements without executing
  --help, -h       Show this help message

Examples:
  bun scripts/migrate-from-vps.ts ./devpad.db
  bun scripts/migrate-from-vps.ts ./devpad.db ./blog.db --env production
  bun scripts/migrate-from-vps.ts ./devpad.db --dry-run
`;

type Config = {
	devpad_db_path: string;
	blog_db_path: string | null;
	env: "preview" | "production";
	dry_run: boolean;
};

function parseArgs(): Config | null {
	const args = process.argv.slice(2);

	if (args.includes("--help") || args.includes("-h") || args.length === 0) {
		console.log(HELP);
		return null;
	}

	let devpad_db_path = "";
	let blog_db_path: string | null = null;
	let env: "preview" | "production" = "preview";
	let dry_run = false;

	const positional: string[] = [];

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--env") {
			const val = args[++i];
			if (val !== "preview" && val !== "production") {
				console.error(`Invalid env: ${val}. Must be 'preview' or 'production'.`);
				process.exit(1);
			}
			env = val;
		} else if (arg === "--dry-run") {
			dry_run = true;
		} else if (!arg.startsWith("-")) {
			positional.push(arg);
		}
	}

	if (positional.length < 1) {
		console.error("Error: devpad.sqlite path is required");
		console.log(HELP);
		return null;
	}

	devpad_db_path = positional[0];
	blog_db_path = positional[1] ?? null;

	return { devpad_db_path, blog_db_path, env, dry_run };
}

function escapeSql(value: unknown): string {
	if (value === null || value === undefined) return "NULL";
	if (typeof value === "number") return String(value);
	if (typeof value === "boolean") return value ? "1" : "0";
	if (typeof value === "object") return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
	return `'${String(value).replace(/'/g, "''")}'`;
}

function buildInsert(table: string, columns: string[], row: Record<string, unknown>): string {
	const values = columns.map(col => escapeSql(row[col]));
	return `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${values.join(", ")});`;
}

async function executeD1(sql: string, env: string, dry_run: boolean): Promise<boolean> {
	if (dry_run) {
		console.log(`[DRY-RUN] ${sql}`);
		return true;
	}

	try {
		await $`wrangler d1 execute DB --remote --env ${env} --command ${sql}`.quiet();
		return true;
	} catch (e) {
		const error = e as Error;
		console.error(`  D1 Error: ${error.message}`);
		return false;
	}
}

async function uploadToR2(bucket: string, key: string, content: string, env: string, dry_run: boolean): Promise<boolean> {
	if (dry_run) {
		console.log(`[DRY-RUN] R2 PUT ${bucket}/${key} (${content.length} bytes)`);
		return true;
	}

	try {
		const proc = Bun.spawn(["wrangler", "r2", "object", "put", `${bucket}/${key}`, "--file", "-", "--env", env], {
			stdin: "pipe",
			stdout: "ignore",
			stderr: "pipe",
		});
		proc.stdin.write(content);
		proc.stdin.end();
		await proc.exited;
		return proc.exitCode === 0;
	} catch (e) {
		const error = e as Error;
		console.error(`  R2 Error: ${error.message}`);
		return false;
	}
}

async function computeContentHash(content: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(content);
	const hashBuffer = await crypto.subtle.digest("SHA-256", data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

function generateVersionId(): string {
	return `v_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

type MigrationStats = {
	table: string;
	total: number;
	success: number;
	failed: number;
};

async function migrateTable(db: Database, table: string, columns: string[], env: string, dry_run: boolean): Promise<MigrationStats> {
	console.log(`\nMigrating table: ${table}`);
	const stats: MigrationStats = { table, total: 0, success: 0, failed: 0 };

	const rows = db.query(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];
	stats.total = rows.length;

	if (rows.length === 0) {
		console.log(`  No rows to migrate`);
		return stats;
	}

	console.log(`  Found ${rows.length} rows`);

	for (const row of rows) {
		const sql = buildInsert(table, columns, row);
		const ok = await executeD1(sql, env, dry_run);
		if (ok) {
			stats.success++;
		} else {
			stats.failed++;
		}
	}

	console.log(`  Migrated: ${stats.success}/${stats.total}${stats.failed > 0 ? ` (${stats.failed} failed)` : ""}`);
	return stats;
}

async function migrateDevpadDb(db_path: string, env: string, dry_run: boolean): Promise<MigrationStats[]> {
	console.log("\n========================================");
	console.log("Migrating devpad database");
	console.log("========================================");

	const file = Bun.file(db_path);
	if (!(await file.exists())) {
		console.error(`Error: Database file not found: ${db_path}`);
		process.exit(1);
	}

	const db = new Database(db_path, { readonly: true });
	const stats: MigrationStats[] = [];

	const tables: { name: string; columns: string[] }[] = [
		{
			name: "user",
			columns: ["id", "github_id", "name", "email", "email_verified", "image_url", "task_view"],
		},
		{
			name: "session",
			columns: ["id", "user_id", "expires_at", "access_token"],
		},
		{
			name: "api_keys",
			columns: ["id", "user_id", "key_hash", "name", "note", "scope", "enabled", "last_used_at", "created_at", "updated_at", "deleted"],
		},
		{
			name: "project",
			columns: [
				"id",
				"created_at",
				"updated_at",
				"deleted",
				"owner_id",
				"project_id",
				"name",
				"description",
				"specification",
				"repo_url",
				"repo_id",
				"icon_url",
				"status",
				"link_url",
				"link_text",
				"visibility",
				"current_version",
				"scan_branch",
			],
		},
		{
			name: "tag",
			columns: ["id", "created_at", "updated_at", "deleted", "owner_id", "title", "color", "render"],
		},
		{
			name: "action",
			columns: ["id", "created_at", "updated_at", "deleted", "owner_id", "type", "description", "data"],
		},
		{
			name: "tracker_result",
			columns: ["id", "project_id", "created_at", "data", "accepted"],
		},
		{
			name: "milestone",
			columns: ["id", "created_at", "updated_at", "deleted", "project_id", "name", "description", "target_time", "target_version", "finished_at", "after_id"],
		},
		{
			name: "ignore_path",
			columns: ["id", "project_id", "path", "created_at", "updated_at"],
		},
		{
			name: "tag_config",
			columns: ["id", "project_id", "tag_id", "match", "created_at", "updated_at"],
		},
		{
			name: "goal",
			columns: ["id", "created_at", "updated_at", "deleted", "milestone_id", "name", "description", "target_time", "finished_at"],
		},
		{
			name: "todo_updates",
			columns: ["id", "project_id", "created_at", "old_id", "new_id", "data", "status", "branch", "commit_sha", "commit_msg", "commit_url"],
		},
		{
			name: "codebase_tasks",
			columns: ["id", "created_at", "updated_at", "deleted", "branch", "commit_sha", "commit_msg", "commit_url", "type", "text", "file", "line", "context", "recent_scan_id"],
		},
		{
			name: "task",
			columns: ["id", "created_at", "updated_at", "deleted", "owner_id", "title", "progress", "visibility", "goal_id", "project_id", "description", "start_time", "end_time", "summary", "codebase_task_id", "priority"],
		},
		{
			name: "checklist",
			columns: ["id", "created_at", "updated_at", "deleted", "task_id", "name"],
		},
		{
			name: "task_tag",
			columns: ["task_id", "tag_id", "created_at", "updated_at"],
		},
		{
			name: "checklist_item",
			columns: ["id", "created_at", "updated_at", "deleted", "checklist_id", "parent_id", "name", "checked"],
		},
		{
			name: "commit_detail",
			columns: ["sha", "message", "url", "avatar_url", "author_user", "author_name", "author_email", "date"],
		},
	];

	for (const table of tables) {
		try {
			const result = await migrateTable(db, table.name, table.columns, env, dry_run);
			stats.push(result);
		} catch (e) {
			const error = e as Error;
			if (error.message.includes("no such table")) {
				console.log(`\nSkipping table ${table.name}: does not exist in source database`);
			} else {
				console.error(`\nError migrating ${table.name}: ${error.message}`);
			}
		}
	}

	db.close();
	return stats;
}

type OldBlogPost = {
	id: number;
	uuid: string;
	author_id: string;
	slug: string;
	title: string;
	content: string;
	description?: string;
	format?: string;
	category: string;
	archived: number;
	publish_at: number | null;
	created_at: number;
	updated_at: number;
};

async function migrateBlogPosts(db: Database, env: string, dry_run: boolean): Promise<{ posts_stats: MigrationStats; corpus_stats: { total: number; success: number; failed: number } }> {
	console.log(`\nMigrating blog_posts with corpus content`);

	const posts_stats: MigrationStats = { table: "blog_posts", total: 0, success: 0, failed: 0 };
	const corpus_stats = { total: 0, success: 0, failed: 0 };

	const rows = db.query(`SELECT * FROM blog_posts`).all() as OldBlogPost[];
	posts_stats.total = rows.length;
	corpus_stats.total = rows.length;

	if (rows.length === 0) {
		console.log(`  No posts to migrate`);
		return { posts_stats, corpus_stats };
	}

	console.log(`  Found ${rows.length} posts`);

	const r2_bucket = env === "production" ? "devpad-corpus" : "devpad-corpus-staging";

	for (const post of rows) {
		const version_id = generateVersionId();

		const post_content = {
			title: post.title,
			content: post.content,
			description: post.description,
			format: (post.format ?? "md") as "md" | "adoc",
		};
		const content_json = JSON.stringify(post_content);
		const content_hash = await computeContentHash(content_json);
		const store_id = `posts/${post.author_id}/${post.uuid}`;
		const data_key = `${store_id}/${version_id}`;
		const created_at = new Date(post.created_at * 1000).toISOString();

		const r2_ok = await uploadToR2(r2_bucket, data_key, content_json, env, dry_run);

		if (r2_ok) {
			const snapshot_sql = buildInsert("corpus_snapshots", ["store_id", "version", "parents", "created_at", "content_hash", "content_type", "size_bytes", "data_key"], {
				store_id,
				version: version_id,
				parents: "[]",
				created_at,
				content_hash,
				content_type: "application/json",
				size_bytes: content_json.length,
				data_key,
			});

			const snapshot_ok = await executeD1(snapshot_sql, env, dry_run);
			if (snapshot_ok) {
				corpus_stats.success++;
			} else {
				corpus_stats.failed++;
			}
		} else {
			corpus_stats.failed++;
		}

		const post_sql = buildInsert("blog_posts", ["id", "uuid", "author_id", "slug", "corpus_version", "category", "archived", "publish_at", "created_at", "updated_at"], {
			id: post.id,
			uuid: post.uuid,
			author_id: post.author_id,
			slug: post.slug,
			corpus_version: version_id,
			category: post.category,
			archived: post.archived,
			publish_at: post.publish_at,
			created_at: post.created_at,
			updated_at: post.updated_at,
		});

		const post_ok = await executeD1(post_sql, env, dry_run);
		if (post_ok) {
			posts_stats.success++;
		} else {
			posts_stats.failed++;
		}
	}

	console.log(`  Posts migrated: ${posts_stats.success}/${posts_stats.total}`);
	console.log(`  Corpus snapshots created: ${corpus_stats.success}/${corpus_stats.total}`);

	return { posts_stats, corpus_stats };
}

async function migrateBlogDb(db_path: string, env: string, dry_run: boolean): Promise<MigrationStats[]> {
	console.log("\n========================================");
	console.log("Migrating blog database");
	console.log("========================================");

	const file = Bun.file(db_path);
	if (!(await file.exists())) {
		console.error(`Error: Database file not found: ${db_path}`);
		process.exit(1);
	}

	const db = new Database(db_path, { readonly: true });
	const stats: MigrationStats[] = [];

	try {
		const categories_result = await migrateTable(db, "blog_categories", ["id", "owner_id", "name", "parent"], env, dry_run);
		stats.push(categories_result);
	} catch (e) {
		const error = e as Error;
		if (!error.message.includes("no such table")) {
			console.error(`Error migrating blog_categories: ${error.message}`);
		}
	}

	try {
		const { posts_stats } = await migrateBlogPosts(db, env, dry_run);
		stats.push(posts_stats);
	} catch (e) {
		const error = e as Error;
		console.error(`Error migrating blog_posts: ${error.message}`);
	}

	const simple_tables: { name: string; columns: string[] }[] = [
		{
			name: "blog_tags",
			columns: ["post_id", "tag"],
		},
		{
			name: "blog_post_projects",
			columns: ["post_id", "project_id", "created_at"],
		},
		{
			name: "blog_integrations",
			columns: ["id", "user_id", "source", "location", "data", "last_fetch", "status", "created_at"],
		},
		{
			name: "blog_fetch_links",
			columns: ["id", "post_id", "integration_id", "identifier"],
		},
	];

	for (const table of simple_tables) {
		try {
			const result = await migrateTable(db, table.name, table.columns, env, dry_run);
			stats.push(result);
		} catch (e) {
			const error = e as Error;
			if (!error.message.includes("no such table")) {
				console.error(`Error migrating ${table.name}: ${error.message}`);
			}
		}
	}

	db.close();
	return stats;
}

function printSummary(devpad_stats: MigrationStats[], blog_stats: MigrationStats[]): void {
	console.log("\n========================================");
	console.log("Migration Summary");
	console.log("========================================");

	const all_stats = [...devpad_stats, ...blog_stats];

	let total_rows = 0;
	let total_success = 0;
	let total_failed = 0;

	console.log("\nTable                    | Total | Success | Failed");
	console.log("-------------------------|-------|---------|-------");

	for (const s of all_stats) {
		const name = s.table.padEnd(24);
		const total = String(s.total).padStart(5);
		const success = String(s.success).padStart(7);
		const failed = String(s.failed).padStart(6);
		console.log(`${name} | ${total} | ${success} | ${failed}`);

		total_rows += s.total;
		total_success += s.success;
		total_failed += s.failed;
	}

	console.log("-------------------------|-------|---------|-------");
	const name = "TOTAL".padEnd(24);
	const total = String(total_rows).padStart(5);
	const success = String(total_success).padStart(7);
	const failed = String(total_failed).padStart(6);
	console.log(`${name} | ${total} | ${success} | ${failed}`);

	if (total_failed > 0) {
		console.log(`\nWarning: ${total_failed} rows failed to migrate.`);
	}
}

async function main(): Promise<void> {
	const config = parseArgs();
	if (!config) {
		process.exit(0);
	}

	console.log("devpad VPS to Cloudflare Migration");
	console.log("===================================");
	console.log(`Target environment: ${config.env}`);
	console.log(`Dry run: ${config.dry_run}`);
	console.log(`devpad DB: ${config.devpad_db_path}`);
	console.log(`Blog DB: ${config.blog_db_path ?? "(not provided)"}`);

	const devpad_stats = await migrateDevpadDb(config.devpad_db_path, config.env, config.dry_run);

	let blog_stats: MigrationStats[] = [];
	if (config.blog_db_path) {
		blog_stats = await migrateBlogDb(config.blog_db_path, config.env, config.dry_run);
	}

	printSummary(devpad_stats, blog_stats);

	if (config.dry_run) {
		console.log("\nThis was a dry run. No data was actually migrated.");
		console.log("Run without --dry-run to perform the actual migration.");
	}
}

main().catch(e => {
	console.error("Migration failed:", e);
	process.exit(1);
});
