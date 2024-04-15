import { sql, relations } from "drizzle-orm";
import { sqliteTable, text, int, foreignKey, unique, integer } from "drizzle-orm/sqlite-core";

export const user = sqliteTable("user", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  github_id: integer("github_id"),
  name: text("name"),
  email: text("email").unique(),
  email_verified: text("email_verified"), // timestamp
  image_url: text("image_url")
});

export const session = sqliteTable("session", {
  id: text("id").notNull().primaryKey(),
  userId: text("user_id").notNull().references(() => user.id),
  expiresAt: integer("expires_at").notNull(),
  access_token: text("access_token")
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
  type: text("type").notNull(), // type of module
  data: text("data", { mode: "json" }).notNull().default("{}"),
  updated_at: text("updated_at").default(sql`(CURRENT_TIMESTAMP)`)
}, (table) => ({
  task_module_unique: unique().on(table.task_id, table.type)
}));

export const task_tag = sqliteTable("task_tag", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  owner_id: text("owner_id").notNull().references(() => user.id),
  title: text("title").notNull(),
  colour: text("colour").notNull().default("#000000"),
});

export const task_to_tags = sqliteTable("task_to_tags", {
  task_id: text("task_id").notNull().references(() => task.id),
  tag_id: text("tag_id").notNull().references(() => task_tag.id),
}, (table) => ({
  task_tags_unique: unique().on(table.task_id, table.tag_id)
}));

// declare many-to-many relationships for task <-> tag
export const task_relations = relations(task, ({ many }) => ({
  task_to_tags: many(task_to_tags),
}));

export const tag_relations = relations(task_tag, ({ many }) => ({
  task_to_tags: many(task_to_tags)
}));

export const task_to_tags_relations = relations(task_to_tags, ({ one }) => ({
  task: one(task, { fields: [task_to_tags.task_id], references: [task.id] }),
  task_tag: one(task_tag, { fields: [task_to_tags.tag_id], references: [task_tag.id] })
}));

export const project = sqliteTable("project", {
  project_id: text("project_id").notNull(),
  owner_id: text("owner_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  specification: text("specification"),
  repo_url: text("repo_url"),
  repo_id: integer("repo_id"),
  icon_url: text("icon_url"),
  status: text("status", { enum: ["DEVELOPMENT", "PAUSED", "RELEASED", "LIVE", "FINISHED", "ABANDONED", "STOPPED"] }).notNull().default("DEVELOPMENT"),
  deleted: int("deleted", { mode: "boolean" }),
  link_url: text("link_url"),
  link_text: text("link_text"),
  visibility: text("visibility", { enum: ["PUBLIC", "PRIVATE", "HIDDEN", "ARCHIVED", "DRAFT", "DELETED"] }),
  current_version: text("current_version"),
}, (table) => ({
  project_unique: unique().on(table.owner_id, table.project_id)
}));

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

export const tracker_result = sqliteTable("tracker_result", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	project_id: text("project_id").notNull().references(() => project.project_id),
	user_id: text("user_id").notNull().references(() => user.id),
	created_at: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	data: text("data", { mode: "json" }).notNull(),
	accepted: integer("accepted", { mode: "boolean" }).notNull().default(false),
});

export const todo_updates = sqliteTable("todo_updates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
	project_id: text("project_id").notNull().references(() => project.project_id),
	user_id: text("user_id").notNull().references(() => user.id),
	created_at: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	old_id: integer("old_id").references(() => tracker_result.id),
	new_id: integer("new_id").notNull().references(() => tracker_result.id),
	data: text("data", { mode: "json" }).notNull(),
	status: text("status", { enum: ["PENDING", "ACCEPTED", "REJECTED"] }).notNull().default("PENDING")
});

export const update_tracker_relations = relations(todo_updates, ({ one }) => ({
	old: one(tracker_result, { fields: [todo_updates.old_id], references: [tracker_result.id] }),
	new: one(tracker_result, { fields: [todo_updates.new_id], references: [tracker_result.id] })
}));

