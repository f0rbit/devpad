import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, int, foreignKey } from "drizzle-orm/sqlite-core";

/** @todo relations */

export const movies = sqliteTable("movies", {
  id: integer("id").primaryKey(),
  title: text("name"),
  releaseYear: integer("release_year"),
});

export const user = sqliteTable("user", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  email_verified: text("email_verified"), // timestamp
  image_url: text("image_url")
});

export const api_key = sqliteTable("api_key", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  owner_id: text("owner_id").references(() => user.id),
  hash: text("hash")
});

export const task = sqliteTable("task", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  owner_id: text("id").notNull().references(() => user.id),
  title: text("title").notNull(),
  progress: text("progress", { enum: ["UNSTARTED", "IN_PROGRESS", "COMPLETED"] }),
  visibility: text("visibility", { enum: ["PUBLIC", "PRIVATE", "HIDDEN", "ARCHIVED", "DRAFT", "DELETED"] }),
  parent_id: text("parent_id"),
  goal_id: text("goal_id"),
  created_at: text("created_at").default(sql`(CURRENT_TIMESTAMP)`),
  updated_at: text("updated_at").default(sql`(CURRENT_TIMESTAMP)`)
}, (table) => ({
  parent_ref: foreignKey({ columns: [table.parent_id], foreignColumns: [table.id], name: "parent_ref" })
}));

export const task_module = sqliteTable("task_module", {
  task_id: text("task_id").notNull().references(() => task.id),
  type: text("string").notNull(), // type of module
  data: text("data", { mode: "json" }).notNull().default({}),
  updated_at: text("updated_at").default(sql`(CURRENT_TIMESTAMP)`)

  // unique restraint [task_id, type]
});

export const task_tag = sqliteTable("task_tag", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  owner_id: text("owner_id").notNull().references(() => user.id),
  title: text("title").notNull(),
  colour: text("colour").notNull().default("#000000"),
});

export const project = sqliteTable("project", {
  project_id: text("project_id").notNull(),
  owner_id: text("owner_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  specification: text("specification"),
  repo_url: text("repo_url"),
  icon_url: text("icon_url"),
  status: text("status", { enum: ["DEVELOPMENT", "PAUSED", "RELEASED", "LIVE", "FINISHED", "ABANDONED", "STOPPED"] }).notNull().default("DEVELOPMENT"),
  deleted: int("deleted", { mode: "boolean" }),
  link_url: text("link_url"),
  link_text: text("link_text"),
  visibility: text("visibility", { enum: ["PUBLIC", "PRIVATE", "HIDDEN", "ARCHIVED", "DRAFT", "DELETED"] }),
  current_version: text("current_version"),

  // unique constraint on [owner_id, project_id]
});

export const project_goal = sqliteTable("project_goal", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  project_id: text("project_id").references(() => project.project_id),
  description: text("description"),
  target_time: text("target_time").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  deleted: int("deleted", { mode: "boolean" }),
  target_version: text("target_version"),
  created_at: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  updated_at: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  finished_at: text("finished_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
});

const ACTIONS = [
  "CREATE_TASK", "UPDATE_TASK", "DELETE_TASK",
  "CREATE_PROJECT", "UPDATE_PROJECT", "DELETE_PROJECT",
  "CREATE_TAG", "UPDATE_TAG", "DELETE_TAG",
  "CREATE_MODULE", "UPDATE_MODULE", "DELETE_MODULE",
  "CREATE_GOAL", "UPDATE_GOAL", "DELETE_GOAL"
] as const;

export const action = sqliteTable("action", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  owner_id: text("owner_id").references(() => user.id),
  type: text("type", { enum: ACTIONS }).notNull(),
  description: text("description").notNull(),
  data: text("data", { mode: "json" }),
  created_at: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  updated_at: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
});
