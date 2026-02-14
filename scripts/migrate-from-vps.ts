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
  --new-user-id <id>  Target user ID to remap all content to (required for blog migration)
  --env <env>         Target environment: preview or production (default: preview)
  --dry-run           Print SQL statements without executing
  --help, -h          Show this help message

Examples:
  bun scripts/migrate-from-vps.ts ./devpad.db
  bun scripts/migrate-from-vps.ts ./devpad.db ./blog.db --new-user-id user_abc123 --env production
  bun scripts/migrate-from-vps.ts ./devpad.db --dry-run

Notes:
  - Login to production first to get your new user ID
  - The --new-user-id flag remaps all owner_id/author_id values in both databases
  - Blog posts will get new UUIDs generated during migration
  - api_key and access_keys tables are skipped (will regenerate)
`;

type Config = {
	devpad_db_path: string;
	blog_db_path: string | null;
	env: "preview" | "production";
	dry_run: boolean;
	new_user_id: string | null;
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
	let new_user_id: string | null = null;

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
		} else if (arg === "--new-user-id") {
			new_user_id = args[++i];
			if (!new_user_id || !new_user_id.startsWith("user_")) {
				console.error(`Invalid --new-user-id: must start with 'user_'`);
				process.exit(1);
			}
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

	return { devpad_db_path, blog_db_path, env, dry_run, new_user_id };
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

function generatePostUuid(): string {
	return `post_${crypto.randomUUID()}`;
}

function timestampToEpoch(ts: string | null): number | null {
	if (!ts) return null;
	const date = new Date(ts);
	if (Number.isNaN(date.getTime())) return null;
	return Math.floor(date.getTime() / 1000);
}

type UserIdMapping = {
	devpad_users: Map<string, string>; // old user_xxx -> new user_xxx
	blog_users: Map<number, string>; // old blog user_id (int) -> new user_xxx
};

function buildUserIdMapping(devpad_db: Database, blog_db: Database | null, new_user_id: string | null): UserIdMapping {
	const mapping: UserIdMapping = {
		devpad_users: new Map(),
		blog_users: new Map(),
	};

	type DevpadUser = { id: string; github_id: number | null };
	const devpad_users = devpad_db.query("SELECT id, github_id FROM user").all() as DevpadUser[];

	const github_to_devpad = new Map<number, string>();
	for (const user of devpad_users) {
		if (new_user_id) {
			mapping.devpad_users.set(user.id, new_user_id);
		} else {
			mapping.devpad_users.set(user.id, user.id);
		}
		if (user.github_id) {
			github_to_devpad.set(user.github_id, new_user_id ?? user.id);
		}
	}

	if (blog_db) {
		type BlogUser = { user_id: number; github_id: number };
		const blog_users = blog_db.query("SELECT user_id, github_id FROM users").all() as BlogUser[];

		for (const user of blog_users) {
			if (new_user_id) {
				mapping.blog_users.set(user.user_id, new_user_id);
			} else {
				const devpad_id = github_to_devpad.get(user.github_id);
				if (devpad_id) {
					mapping.blog_users.set(user.user_id, devpad_id);
				} else {
					console.warn(`  Warning: Blog user ${user.user_id} (github_id=${user.github_id}) has no matching devpad user`);
				}
			}
		}
	}

	return mapping;
}

type MigrationStats = {
	table: string;
	total: number;
	success: number;
	failed: number;
};

async function migrateTable(db: Database, table: string, columns: string[], env: string, dry_run: boolean, transform?: (row: Record<string, unknown>) => Record<string, unknown> | null): Promise<MigrationStats> {
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
		const transformed = transform ? transform(row) : row;
		if (transformed === null) {
			stats.failed++;
			continue;
		}

		const sql = buildInsert(table, columns, transformed);
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

async function migrateDevpadDb(db_path: string, env: string, dry_run: boolean, user_mapping: UserIdMapping): Promise<MigrationStats[]> {
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

	const remapOwnerId = (row: Record<string, unknown>): Record<string, unknown> => {
		const owner_id = row.owner_id as string;
		const new_owner_id = user_mapping.devpad_users.get(owner_id);
		if (!new_owner_id) {
			console.warn(`  Warning: Unknown owner_id ${owner_id}, keeping original`);
			return row;
		}
		return { ...row, owner_id: new_owner_id };
	};

	const remapUserId = (row: Record<string, unknown>): Record<string, unknown> => {
		const user_id = row.user_id as string;
		const new_user_id = user_mapping.devpad_users.get(user_id);
		if (!new_user_id) {
			console.warn(`  Warning: Unknown user_id ${user_id}, keeping original`);
			return row;
		}
		return { ...row, user_id: new_user_id };
	};

	const tables: { name: string; columns: string[]; target_table?: string; transform?: (row: Record<string, unknown>) => Record<string, unknown> | null }[] = [
		{
			name: "user",
			columns: ["id", "github_id", "name", "email", "email_verified", "image_url", "task_view"],
			transform: row => {
				const id = row.id as string;
				const new_id = user_mapping.devpad_users.get(id);
				return new_id ? { ...row, id: new_id } : row;
			},
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
			transform: remapOwnerId,
		},
		{
			name: "tag",
			columns: ["id", "created_at", "updated_at", "deleted", "owner_id", "title", "color", "render"],
			transform: remapOwnerId,
		},
		{
			name: "action",
			columns: ["id", "created_at", "updated_at", "deleted", "owner_id", "type", "description", "data"],
			transform: remapOwnerId,
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
			transform: remapOwnerId,
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

	// Tables to SKIP:
	// - api_key: Old schema has (id, owner_id, hash), new has different structure. Users will create new keys.
	// - session: Will regenerate on login

	console.log("\n  Skipping: api_key (different schema, will regenerate)");
	console.log("  Skipping: session (will regenerate on login)");

	for (const table of tables) {
		try {
			const target = table.target_table ?? table.name;
			const result = await migrateTable(db, table.name, table.columns, env, dry_run, table.transform);
			result.table = target;
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
	author_id: number;
	slug: string;
	title: string;
	content: string;
	description: string;
	format: string;
	category: string;
	archived: number;
	publish_at: string | null;
	created_at: string;
	updated_at: string;
};

type PostIdMapping = Map<number, { new_id: number; uuid: string }>;

async function migrateBlogPosts(db: Database, env: string, dry_run: boolean, user_mapping: UserIdMapping): Promise<{ stats: MigrationStats; corpus_stats: { total: number; success: number; failed: number }; post_mapping: PostIdMapping }> {
	console.log(`\nMigrating posts -> blog_posts with corpus content`);

	const stats: MigrationStats = { table: "blog_posts", total: 0, success: 0, failed: 0 };
	const corpus_stats = { total: 0, success: 0, failed: 0 };
	const post_mapping: PostIdMapping = new Map();

	const rows = db.query(`SELECT * FROM posts`).all() as OldBlogPost[];
	stats.total = rows.length;
	corpus_stats.total = rows.length;

	if (rows.length === 0) {
		console.log(`  No posts to migrate`);
		return { stats, corpus_stats, post_mapping };
	}

	console.log(`  Found ${rows.length} posts`);

	const r2_bucket = env === "production" ? "devpad-corpus" : "devpad-corpus-staging";

	let new_id = 1;
	for (const post of rows) {
		const author_id = user_mapping.blog_users.get(post.author_id);
		if (!author_id) {
			console.warn(`  Skipping post ${post.id}: no user mapping for author_id=${post.author_id}`);
			stats.failed++;
			corpus_stats.failed++;
			continue;
		}

		const post_uuid = generatePostUuid();
		const version_id = generateVersionId();

		post_mapping.set(post.id, { new_id, uuid: post_uuid });

		const post_content = {
			title: post.title,
			content: post.content,
			description: post.description ?? "",
			format: (post.format ?? "md") as "md" | "adoc",
		};
		const content_json = JSON.stringify(post_content);
		const content_hash = await computeContentHash(content_json);
		const store_id = `posts/${author_id}/${post_uuid}`;
		const data_key = `${store_id}/${version_id}`;

		const created_at_epoch = timestampToEpoch(post.created_at);
		const created_at_iso = created_at_epoch ? new Date(created_at_epoch * 1000).toISOString() : new Date().toISOString();

		const r2_ok = await uploadToR2(r2_bucket, data_key, content_json, env, dry_run);

		if (r2_ok) {
			const snapshot_sql = buildInsert("corpus_snapshots", ["store_id", "version", "parents", "created_at", "content_hash", "content_type", "size_bytes", "data_key"], {
				store_id,
				version: version_id,
				parents: "[]",
				created_at: created_at_iso,
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

		const publish_at_epoch = timestampToEpoch(post.publish_at);
		const updated_at_epoch = timestampToEpoch(post.updated_at);

		const post_sql = buildInsert("blog_posts", ["id", "uuid", "author_id", "slug", "corpus_version", "category", "archived", "publish_at", "created_at", "updated_at"], {
			id: new_id,
			uuid: post_uuid,
			author_id,
			slug: post.slug,
			corpus_version: version_id,
			category: post.category,
			archived: post.archived ? 1 : 0,
			publish_at: publish_at_epoch,
			created_at: created_at_epoch ?? Math.floor(Date.now() / 1000),
			updated_at: updated_at_epoch ?? Math.floor(Date.now() / 1000),
		});

		const post_ok = await executeD1(post_sql, env, dry_run);
		if (post_ok) {
			stats.success++;
		} else {
			stats.failed++;
		}

		new_id++;
	}

	console.log(`  Posts migrated: ${stats.success}/${stats.total}`);
	console.log(`  Corpus snapshots created: ${corpus_stats.success}/${corpus_stats.total}`);

	return { stats, corpus_stats, post_mapping };
}

async function migrateBlogCategories(db: Database, env: string, dry_run: boolean, user_mapping: UserIdMapping): Promise<MigrationStats> {
	console.log(`\nMigrating categories -> blog_categories`);

	const stats: MigrationStats = { table: "blog_categories", total: 0, success: 0, failed: 0 };

	type OldCategory = { owner_id: number; name: string; parent: string | null };
	const rows = db.query(`SELECT owner_id, name, parent FROM categories`).all() as OldCategory[];
	stats.total = rows.length;

	if (rows.length === 0) {
		console.log(`  No categories to migrate`);
		return stats;
	}

	console.log(`  Found ${rows.length} categories`);

	for (const row of rows) {
		const owner_id = user_mapping.blog_users.get(row.owner_id);
		if (!owner_id) {
			console.warn(`  Skipping category ${row.name}: no user mapping for owner_id=${row.owner_id}`);
			stats.failed++;
			continue;
		}

		const sql = buildInsert("blog_categories", ["owner_id", "name", "parent"], {
			owner_id,
			name: row.name,
			parent: row.parent ?? "root",
		});

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

async function migrateBlogTags(db: Database, env: string, dry_run: boolean, post_mapping: PostIdMapping): Promise<MigrationStats> {
	console.log(`\nMigrating tags -> blog_tags`);

	const stats: MigrationStats = { table: "blog_tags", total: 0, success: 0, failed: 0 };

	type OldTag = { post_id: number; tag: string };
	const rows = db.query(`SELECT post_id, tag FROM tags`).all() as OldTag[];
	stats.total = rows.length;

	if (rows.length === 0) {
		console.log(`  No tags to migrate`);
		return stats;
	}

	console.log(`  Found ${rows.length} tags`);

	for (const row of rows) {
		const post_info = post_mapping.get(row.post_id);
		if (!post_info) {
			console.warn(`  Skipping tag: no mapping for post_id=${row.post_id}`);
			stats.failed++;
			continue;
		}

		const sql = buildInsert("blog_tags", ["post_id", "tag"], {
			post_id: post_info.new_id,
			tag: row.tag,
		});

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

async function migrateBlogPostProjects(db: Database, env: string, dry_run: boolean, post_mapping: PostIdMapping): Promise<MigrationStats> {
	console.log(`\nMigrating posts_projects -> blog_post_projects`);

	const stats: MigrationStats = { table: "blog_post_projects", total: 0, success: 0, failed: 0 };

	type OldPostProject = { post_id: number; project_uuid: string };
	const rows = db.query(`SELECT post_id, project_uuid FROM posts_projects`).all() as OldPostProject[];
	stats.total = rows.length;

	if (rows.length === 0) {
		console.log(`  No post_projects to migrate`);
		return stats;
	}

	console.log(`  Found ${rows.length} post_projects`);

	for (const row of rows) {
		const post_info = post_mapping.get(row.post_id);
		if (!post_info) {
			console.warn(`  Skipping post_project: no mapping for post_id=${row.post_id}`);
			stats.failed++;
			continue;
		}

		const sql = buildInsert("blog_post_projects", ["post_id", "project_id", "created_at"], {
			post_id: post_info.new_id,
			project_id: row.project_uuid,
			created_at: Math.floor(Date.now() / 1000),
		});

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

async function migrateBlogIntegrations(db: Database, env: string, dry_run: boolean, user_mapping: UserIdMapping, post_mapping: PostIdMapping): Promise<MigrationStats[]> {
	const stats: MigrationStats[] = [];

	// Migrate fetch_queue -> blog_integrations
	console.log(`\nMigrating fetch_queue -> blog_integrations`);

	type OldFetchQueue = {
		id: number;
		user_id: number;
		last_fetch: string | null;
		location: string;
		source: string;
		data: string | null;
		created_at: string;
	};

	const integration_stats: MigrationStats = { table: "blog_integrations", total: 0, success: 0, failed: 0 };
	const integration_mapping = new Map<number, number>();

	try {
		const rows = db.query(`SELECT * FROM fetch_queue`).all() as OldFetchQueue[];
		integration_stats.total = rows.length;

		if (rows.length > 0) {
			console.log(`  Found ${rows.length} fetch_queue entries`);

			let new_id = 1;
			for (const row of rows) {
				const user_id = user_mapping.blog_users.get(row.user_id);
				if (!user_id) {
					console.warn(`  Skipping fetch_queue ${row.id}: no user mapping for user_id=${row.user_id}`);
					integration_stats.failed++;
					continue;
				}

				integration_mapping.set(row.id, new_id);

				const last_fetch_epoch = timestampToEpoch(row.last_fetch);
				const created_at_epoch = timestampToEpoch(row.created_at);

				const sql = buildInsert("blog_integrations", ["id", "user_id", "source", "location", "data", "last_fetch", "status", "created_at"], {
					id: new_id,
					user_id,
					source: row.source,
					location: row.location,
					data: row.data,
					last_fetch: last_fetch_epoch,
					status: "pending",
					created_at: created_at_epoch ?? Math.floor(Date.now() / 1000),
				});

				const ok = await executeD1(sql, env, dry_run);
				if (ok) {
					integration_stats.success++;
				} else {
					integration_stats.failed++;
				}
				new_id++;
			}

			console.log(`  Migrated: ${integration_stats.success}/${integration_stats.total}`);
		} else {
			console.log(`  No fetch_queue entries to migrate`);
		}
	} catch (e) {
		const error = e as Error;
		if (!error.message.includes("no such table")) {
			console.error(`Error migrating fetch_queue: ${error.message}`);
		}
	}

	stats.push(integration_stats);

	// Migrate fetch_links -> blog_fetch_links
	console.log(`\nMigrating fetch_links -> blog_fetch_links`);

	type OldFetchLink = {
		post_id: number;
		fetch_source: number;
		identifier: string;
	};

	const links_stats: MigrationStats = { table: "blog_fetch_links", total: 0, success: 0, failed: 0 };

	try {
		const rows = db.query(`SELECT post_id, fetch_source, identifier FROM fetch_links`).all() as OldFetchLink[];
		links_stats.total = rows.length;

		if (rows.length > 0) {
			console.log(`  Found ${rows.length} fetch_links`);

			for (const row of rows) {
				const post_info = post_mapping.get(row.post_id);
				const integration_id = integration_mapping.get(row.fetch_source);

				if (!post_info) {
					console.warn(`  Skipping fetch_link: no mapping for post_id=${row.post_id}`);
					links_stats.failed++;
					continue;
				}
				if (!integration_id) {
					console.warn(`  Skipping fetch_link: no mapping for fetch_source=${row.fetch_source}`);
					links_stats.failed++;
					continue;
				}

				const sql = buildInsert("blog_fetch_links", ["post_id", "integration_id", "identifier"], {
					post_id: post_info.new_id,
					integration_id,
					identifier: row.identifier,
				});

				const ok = await executeD1(sql, env, dry_run);
				if (ok) {
					links_stats.success++;
				} else {
					links_stats.failed++;
				}
			}

			console.log(`  Migrated: ${links_stats.success}/${links_stats.total}`);
		} else {
			console.log(`  No fetch_links to migrate`);
		}
	} catch (e) {
		const error = e as Error;
		if (!error.message.includes("no such table")) {
			console.error(`Error migrating fetch_links: ${error.message}`);
		}
	}

	stats.push(links_stats);

	return stats;
}

async function migrateBlogDb(db_path: string, env: string, dry_run: boolean, user_mapping: UserIdMapping): Promise<MigrationStats[]> {
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

	// Check user mapping
	if (user_mapping.blog_users.size === 0) {
		console.error("Error: No user ID mapping for blog users. Did you provide --new-user-id?");
		db.close();
		return stats;
	}

	console.log("\n  Skipping: access_keys (plaintext keys, will regenerate)");
	console.log("  Skipping: devpad_api_tokens (will regenerate)");
	console.log("  Skipping: projects_cache (will refetch)");

	// Categories first (no dependencies)
	try {
		const result = await migrateBlogCategories(db, env, dry_run, user_mapping);
		stats.push(result);
	} catch (e) {
		const error = e as Error;
		if (!error.message.includes("no such table")) {
			console.error(`Error migrating categories: ${error.message}`);
		}
	}

	// Posts next (generates UUIDs and post_mapping)
	let post_mapping: PostIdMapping = new Map();
	try {
		const { stats: posts_stats, post_mapping: mapping } = await migrateBlogPosts(db, env, dry_run, user_mapping);
		stats.push(posts_stats);
		post_mapping = mapping;
	} catch (e) {
		const error = e as Error;
		console.error(`Error migrating posts: ${error.message}`);
	}

	// Tags (depends on post_mapping)
	try {
		const result = await migrateBlogTags(db, env, dry_run, post_mapping);
		stats.push(result);
	} catch (e) {
		const error = e as Error;
		if (!error.message.includes("no such table")) {
			console.error(`Error migrating tags: ${error.message}`);
		}
	}

	// Post-projects (depends on post_mapping)
	try {
		const result = await migrateBlogPostProjects(db, env, dry_run, post_mapping);
		stats.push(result);
	} catch (e) {
		const error = e as Error;
		if (!error.message.includes("no such table")) {
			console.error(`Error migrating posts_projects: ${error.message}`);
		}
	}

	// Integrations and fetch_links
	try {
		const integration_stats = await migrateBlogIntegrations(db, env, dry_run, user_mapping, post_mapping);
		stats.push(...integration_stats);
	} catch (e) {
		const error = e as Error;
		console.error(`Error migrating integrations: ${error.message}`);
	}

	db.close();
	return stats;
}

function printSummary(devpad_stats: MigrationStats[], blog_stats: MigrationStats[], user_mapping: UserIdMapping): void {
	console.log("\n========================================");
	console.log("Migration Summary");
	console.log("========================================");

	// Print user mapping info
	console.log("\nUser ID Mapping:");
	for (const [old_id, new_id] of user_mapping.devpad_users) {
		if (old_id !== new_id) {
			console.log(`  devpad: ${old_id} -> ${new_id}`);
		}
	}
	for (const [old_id, new_id] of user_mapping.blog_users) {
		console.log(`  blog: user_id=${old_id} -> ${new_id}`);
	}

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
	console.log(`New user ID: ${config.new_user_id ?? "(not provided - using original IDs)"}`);

	// Validate blog migration requires new_user_id or existing mapping
	if (config.blog_db_path && !config.new_user_id) {
		console.warn("\nWarning: Blog migration without --new-user-id will try to match via github_id");
	}

	// Load devpad db first to build user mapping
	const devpad_file = Bun.file(config.devpad_db_path);
	if (!(await devpad_file.exists())) {
		console.error(`Error: Database file not found: ${config.devpad_db_path}`);
		process.exit(1);
	}

	const devpad_db = new Database(config.devpad_db_path, { readonly: true });
	let blog_db: Database | null = null;

	if (config.blog_db_path) {
		const blog_file = Bun.file(config.blog_db_path);
		if (!(await blog_file.exists())) {
			console.error(`Error: Database file not found: ${config.blog_db_path}`);
			process.exit(1);
		}
		blog_db = new Database(config.blog_db_path, { readonly: true });
	}

	const user_mapping = buildUserIdMapping(devpad_db, blog_db, config.new_user_id);

	console.log("\nUser mapping built:");
	console.log(`  devpad users: ${user_mapping.devpad_users.size}`);
	console.log(`  blog users: ${user_mapping.blog_users.size}`);

	devpad_db.close();
	blog_db?.close();

	const devpad_stats = await migrateDevpadDb(config.devpad_db_path, config.env, config.dry_run, user_mapping);

	let blog_stats: MigrationStats[] = [];
	if (config.blog_db_path) {
		blog_stats = await migrateBlogDb(config.blog_db_path, config.env, config.dry_run, user_mapping);
	}

	printSummary(devpad_stats, blog_stats, user_mapping);

	if (config.dry_run) {
		console.log("\nThis was a dry run. No data was actually migrated.");
		console.log("Run without --dry-run to perform the actual migration.");
	}
}

main().catch(e => {
	console.error("Migration failed:", e);
	process.exit(1);
});
