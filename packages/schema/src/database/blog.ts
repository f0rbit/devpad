import { sql } from "drizzle-orm";
import { integer, primaryKey, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

export const blog_posts = sqliteTable(
	"blog_posts",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		uuid: text("uuid").notNull().unique(),
		author_id: text("author_id").notNull(),
		slug: text("slug").notNull(),
		corpus_version: text("corpus_version"),
		category: text("category").notNull().default("root"),
		archived: integer("archived", { mode: "boolean" }).notNull().default(false),
		publish_at: integer("publish_at", { mode: "timestamp" }),
		created_at: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
		updated_at: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
	},
	table => ({
		posts_author_slug_unique: unique("posts_author_slug_unique").on(table.author_id, table.slug),
	})
);

export const blog_categories = sqliteTable(
	"blog_categories",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		owner_id: text("owner_id").notNull(),
		name: text("name").notNull(),
		parent: text("parent").default("root"),
	},
	table => ({
		categories_owner_name_unique: unique("categories_owner_name_unique").on(table.owner_id, table.name),
	})
);

export const blog_tags = sqliteTable(
	"blog_tags",
	{
		post_id: integer("post_id")
			.notNull()
			.references(() => blog_posts.id, { onDelete: "cascade" }),
		tag: text("tag").notNull(),
	},
	table => ({
		blog_tags_pk: primaryKey({ columns: [table.post_id, table.tag] }),
	})
);

export const blog_access_keys = sqliteTable("access_keys", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	user_id: text("user_id").notNull(),
	key_hash: text("key_hash").notNull().unique(),
	name: text("name").notNull(),
	note: text("note"),
	enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
	created_at: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

export const blog_integrations = sqliteTable("blog_integrations", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	user_id: text("user_id").notNull(),
	source: text("source").notNull(),
	location: text("location").notNull(),
	data: text("data", { mode: "json" }).$type<Record<string, unknown>>(),
	last_fetch: integer("last_fetch", { mode: "timestamp" }),
	status: text("status").default("pending"),
	created_at: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

export const blog_fetch_links = sqliteTable(
	"blog_fetch_links",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		post_id: integer("post_id")
			.notNull()
			.references(() => blog_posts.id, { onDelete: "cascade" }),
		integration_id: integer("integration_id")
			.notNull()
			.references(() => blog_integrations.id, { onDelete: "cascade" }),
		identifier: text("identifier").notNull(),
	},
	table => ({
		fetch_links_integration_identifier_unique: unique("fetch_links_integration_identifier_unique").on(table.integration_id, table.identifier),
	})
);

export const blog_post_projects = sqliteTable(
	"blog_post_projects",
	{
		post_id: integer("post_id")
			.notNull()
			.references(() => blog_posts.id, { onDelete: "cascade" }),
		project_id: text("project_id").notNull(),
		created_at: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
	},
	table => ({
		blog_post_projects_pk: primaryKey({ columns: [table.post_id, table.project_id] }),
	})
);
