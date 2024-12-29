import { sql, relations } from "drizzle-orm";
import { sqliteTable, text, int, unique, integer, primaryKey } from "drizzle-orm/sqlite-core";

export const user = sqliteTable("user", {
  id: text("id").primaryKey().$defaultFn(() => "user_" + crypto.randomUUID()),
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
  id: text("id").primaryKey().$defaultFn(() => "api_key" + crypto.randomUUID()),
  owner_id: text("owner_id").references(() => user.id),
  hash: text("hash")
});

export const project = sqliteTable("project", {
  id: text("id").primaryKey().$defaultFn(() => "project_" + crypto.randomUUID()),
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
  config_json: text("config_json", { mode: "json" }),
  scan_branch: text("scan_branch"),
}, (table) => ({
  project_unique: unique().on(table.owner_id, table.project_id)
}));

const ACTIONS = [
  "CREATE_TASK", "UPDATE_TASK", "DELETE_TASK",
  "CREATE_PROJECT", "UPDATE_PROJECT", "DELETE_PROJECT",
  "CREATE_TAG", "UPDATE_TAG", "DELETE_TAG",
  "CREATE_GOAL", "UPDATE_GOAL", "DELETE_GOAL",
  "CREATE_MILESTONE", "UPDATE_MILESTONE", "DELETE_MILESTONE",
  "CREATE_CHECKLIST", "UPDATE_CHECKLIST", "DELETE_CHECKLIST",
] as const;

export const action = sqliteTable("action", {
  id: text("id").primaryKey().$defaultFn(() => "action_" + crypto.randomUUID()),
  owner_id: text("owner_id").references(() => user.id),
  type: text("type", { enum: ACTIONS }).notNull(),
  description: text("description").notNull(),
  data: text("data", { mode: "json" }),
  created_at: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  updated_at: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
});

export const tracker_result = sqliteTable("tracker_result", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  project_id: text("project_id").notNull().references(() => project.id),
  created_at: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  data: text("data", { mode: "json" }).notNull(),
  accepted: integer("accepted", { mode: "boolean" }).notNull().default(false),
});

export const todo_updates = sqliteTable("todo_updates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  project_id: text("project_id").notNull().references(() => project.id),
  created_at: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  old_id: integer("old_id").references(() => tracker_result.id),
  new_id: integer("new_id").notNull().references(() => tracker_result.id),
  data: text("data", { mode: "json" }).notNull(),
  status: text("status", { enum: ["PENDING", "ACCEPTED", "REJECTED", "IGNORED"] }).notNull().default("PENDING"),
  /** @todo normalise to a commits table */
  branch: text("branch"),
  commit_sha: text("commit_sha"),
  commit_msg: text("commit_msg"),
  commit_url: text("commit_url"),
});

export const update_tracker_relations = relations(todo_updates, ({ one }) => ({
  old: one(tracker_result, { fields: [todo_updates.old_id], references: [tracker_result.id] }),
  new: one(tracker_result, { fields: [todo_updates.new_id], references: [tracker_result.id] })
}));

export const milestone = sqliteTable("milestone", {
  id: text("id").primaryKey().$defaultFn(() => "milestone_" + crypto.randomUUID()),
  project_id: text("project_id").notNull().references(() => project.id),
  name: text("name").notNull(),
  description: text("description"),
  target_time: text("target_time"),
  deleted: int("deleted", { mode: "boolean" }),
  target_version: text("target_version"),
  created_at: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  updated_at: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  finished_at: text("finished_at"),
  after_id: text("after_id"),
});

export const goal = sqliteTable("goal", {
  id: text("id").primaryKey().$defaultFn(() => "goal_" + crypto.randomUUID()),
  milestone_id: text("milestone_id").notNull().references(() => milestone.id),
  name: text("name").notNull(),
  description: text("description"),
  target_time: text("target_time"),
  deleted: int("deleted", { mode: "boolean" }),
  created_at: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  updated_at: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  finished_at: text("finished_at"),
});

export const task = sqliteTable("task", {
  id: text("id").primaryKey().$defaultFn(() => "task_" + crypto.randomUUID()),
  owner_id: text("owner_id").notNull().references(() => user.id),
  title: text("title").notNull(),
  progress: text("progress", { enum: ["UNSTARTED", "IN_PROGRESS", "COMPLETED"] }).notNull().default("UNSTARTED"),
  visibility: text("visibility", { enum: ["PUBLIC", "PRIVATE", "HIDDEN", "ARCHIVED", "DRAFT", "DELETED"] }).notNull().default("PRIVATE"),
  goal_id: text("goal_id").references(() => goal.id),
  project_id: text("project_id").references(() => project.id),
  description: text("description"),
  start_time: text("start_time"),
  end_time: text("end_time"),
  summary: text("summary"),
  codebase_task_id: text("codebase_task_id").references(() => codebase_tasks.id),
  priority: text("priority", { enum: ["LOW", "MEDIUM", "HIGH"] }).notNull().default("LOW"),
  created_at: text("created_at").default(sql`(CURRENT_TIMESTAMP)`),
  updated_at: text("updated_at").default(sql`(CURRENT_TIMESTAMP)`)
});

export const checklist = sqliteTable("checklist", {
  id: text("id").primaryKey().$defaultFn(() => "checklist_" + crypto.randomUUID()),
  task_id: text("task_id").notNull().references(() => task.id),
  name: text("name").notNull(),
  created_at: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  updated_at: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  deleted: int("deleted", { mode: "boolean" }),
});

export const checklist_item = sqliteTable("checklist_item", {
  id: text("id").primaryKey().$defaultFn(() => "checklist-item_" + crypto.randomUUID()),
  checklist_id: text("checklist_id").notNull().references(() => checklist.id),
  parent_id: text("parent_id"),
  name: text("name").notNull(),
  checked: int("checked", { mode: "boolean" }).notNull().default(false),
});

export const codebase_tasks = sqliteTable("codebase_tasks", {
  id: text("id").primaryKey().$defaultFn(() => "codebase-task_" + crypto.randomUUID()),
  branch: text("branch"),
  commit_sha: text("commit_sha"),
  commit_msg: text("commit_msg"),
  commit_url: text("commit_url"),
  type: text("type"),
  text: text("text"),
  file: text("file"),
  line: integer("line"),
  context: text("context", { mode: "json" }),
  created_at: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  updated_at: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  deleted: int("deleted", { mode: "boolean" }),
  recent_scan_id: integer("recent_scan_id").references(() => tracker_result.id),
});

export const tag = sqliteTable("tag", {
  id: text("id").primaryKey().$defaultFn(() => "tag_" + crypto.randomUUID()),
  owner_id: text("owner_id").notNull().references(() => user.id),
  title: text("title").notNull(),
  color: text("color"),
  created_at: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  updated_at: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  deleted: int("deleted", { mode: "boolean" }),
}, (table) => ({
  tag_unique: unique("tag_unique").on(table.owner_id, table.title)
}));

export const task_tag = sqliteTable("task_tag", {
  task_id: text("task_id").notNull().references(() => task.id),
  tag_id: text("tag_id").notNull().references(() => tag.id),
  created_at: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  updated_at: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
}, (table) => ({
  task_tag_unique: primaryKey({ columns: [table.task_id, table.tag_id] })
}));

export const commit_detail = sqliteTable("commit_detail", {
	sha: text("sha").primaryKey(),
	message: text("message").notNull(),
	url: text("url").notNull(),
	avatar_url: text("avatar_url"),
	author_user: text("author_user").notNull(),
	author_name: text("author_name"),
	author_email: text("author_email").notNull(),
	date: text("date").notNull(),
});

// relations

export const user_relations = relations(user, ({ many }) => ({
  sessions: many(session),
  api_keys: many(api_key),
  actions: many(action),
  tasks: many(task),
  tags: many(tag)
}));

export const session_relations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] })
}));

export const api_key_relations = relations(api_key, ({ one }) => ({
  owner: one(user, { fields: [api_key.owner_id], references: [user.id] })
}));

export const project_relations = relations(project, ({ one, many }) => ({
  owner: one(user, { fields: [project.owner_id], references: [user.id] }),
  tracker_results: many(tracker_result),
  milestones: many(milestone),
  todo_updates: many(todo_updates)
}));

export const action_relations = relations(action, ({ one }) => ({
  owner: one(user, { fields: [action.owner_id], references: [user.id] })
}));

export const tracker_result_relations = relations(tracker_result, ({ one }) => ({
  project: one(project, { fields: [tracker_result.project_id], references: [project.id] })
}));

export const todoUpdatesRelations = relations(todo_updates, ({ one }) => ({
  project: one(project, { fields: [todo_updates.project_id], references: [project.id] }),
  oldTrackerResult: one(tracker_result, { fields: [todo_updates.old_id], references: [tracker_result.id] }),
  newTrackerResult: one(tracker_result, { fields: [todo_updates.new_id], references: [tracker_result.id] })
}));

export const milestone_relations = relations(milestone, ({ one, many }) => ({
  project: one(project, { fields: [milestone.project_id], references: [project.id] }),
  goals: many(goal)
}));

export const goal_relations = relations(goal, ({ one }) => ({
  milestone: one(milestone, { fields: [goal.milestone_id], references: [milestone.id] })
}));

export const task_relations = relations(task, ({ one, many }) => ({
  owner: one(user, { fields: [task.owner_id], references: [user.id] }),
  goal: one(goal, { fields: [task.goal_id], references: [goal.id] }),
  codebase_task: one(codebase_tasks, { fields: [task.codebase_task_id], references: [codebase_tasks.id] }),
  checklists: many(checklist)
}));

export const checklist_relations = relations(checklist, ({ one, many }) => ({
  task: one(task, { fields: [checklist.task_id], references: [task.id] }),
  items: many(checklist_item)
}));

export const checklist_item_relations = relations(checklist_item, ({ one }) => ({
  checklist: one(checklist, { fields: [checklist_item.checklist_id], references: [checklist.id] })
}));

export const tag_relations = relations(tag, ({ one }) => ({
  owner: one(user, { fields: [tag.owner_id], references: [user.id] })
}));

export const task_tag_relations = relations(task_tag, ({ one }) => ({
  task: one(task, { fields: [task_tag.task_id], references: [task.id] }),
  tag: one(tag, { fields: [task_tag.tag_id], references: [tag.id] })
}));

