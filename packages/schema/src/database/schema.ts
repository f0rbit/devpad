import { relations, sql } from "drizzle-orm";
import { index, int, integer, primaryKey, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
export const timestamps = () => ({
	created_at: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	updated_at: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
});

export const deleted = () => ({
	deleted: int("deleted", { mode: "boolean" }).notNull().default(false),
});

export const provenance = () => ({
	created_by: text("created_by", { enum: ["user", "api"] })
		.notNull()
		.default("user"),
	modified_by: text("modified_by", { enum: ["user", "api"] })
		.notNull()
		.default("user"),
	protected: int("protected", { mode: "boolean" }).notNull().default(false),
});

export const owner_id = () => ({
	owner_id: text("owner_id")
		.notNull()
		.references(() => user.id),
});

export const id = (prefix: string) => ({
	id: text("id")
		.primaryKey()
		.$defaultFn(() => `${prefix}_${crypto.randomUUID()}`),
});

export const entity = (prefix: string) => ({
	...id(prefix),
	...timestamps(),
	...deleted(),
	...provenance(),
});

export const owned_entity = (prefix: string) => ({
	...entity(prefix),
	...owner_id(),
});
export const user = sqliteTable("user", {
	id: text("id")
		.primaryKey()
		.$defaultFn(() => `user_${crypto.randomUUID()}`),
	github_id: integer("github_id"),
	name: text("name"),
	email: text("email").unique(),
	email_verified: text("email_verified"), // timestamp
	image_url: text("image_url"),
	task_view: text("task_view", { enum: ["list", "grid"] })
		.notNull()
		.default("list"),
});

export const session = sqliteTable("session", {
	id: text("id").notNull().primaryKey(),
	userId: text("user_id")
		.notNull()
		.references(() => user.id),
	expiresAt: integer("expires_at").notNull(),
	access_token: text("access_token"),
});

export const api_keys = sqliteTable("api_keys", {
	...id("apikey"),
	user_id: text("user_id")
		.notNull()
		.references(() => user.id),
	key_hash: text("key_hash").notNull().unique(),
	name: text("name"),
	note: text("note"),
	scope: text("scope", { enum: ["devpad", "blog", "media", "pulse", "all"] })
		.notNull()
		.default("all"),
	// v2.4 (task A3.1): nullable project scope. `null` = legacy all-projects
	// key, behaves exactly as before. Non-null keys are rejected by the
	// scope guard (`packages/worker/src/middleware/scope-guard.ts`) on any
	// resource belonging to a different project.
	project_id: text("project_id").references(() => project.id),
	enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
	last_used_at: text("last_used_at"),
	...timestamps(),
	deleted: integer("deleted", { mode: "boolean" }).notNull().default(false),
});

export const project = sqliteTable("project", {
	...owned_entity("project"),
	project_id: text("project_id").notNull(),
	name: text("name").notNull(),
	description: text("description"),
	specification: text("specification"),
	repo_url: text("repo_url"),
	repo_id: integer("repo_id"),
	icon_url: text("icon_url"),
	status: text("status", { enum: ["DEVELOPMENT", "PAUSED", "RELEASED", "LIVE", "FINISHED", "ABANDONED", "STOPPED"] })
		.notNull()
		.default("DEVELOPMENT"),
	link_url: text("link_url"),
	link_text: text("link_text"),
	visibility: text("visibility", { enum: ["PUBLIC", "PRIVATE", "HIDDEN", "ARCHIVED", "DRAFT", "DELETED"] })
		.notNull()
		.default("PRIVATE"),
	current_version: text("current_version"),
	scan_branch: text("scan_branch"),
	// v2.4 (task A3.6) — per-project opt-in, OFF by default: a merged PR
	// completes its linked task automatically via the GitHub App inbound
	// webhook. Diff-linked status because agents are unreliable narrators.
	github_autoclose: integer("github_autoclose", { mode: "boolean" }).notNull().default(false),
});

const ACTIONS = [
	"CREATE_TASK",
	"UPDATE_TASK",
	"DELETE_TASK",
	"CREATE_PROJECT",
	"UPDATE_PROJECT",
	"DELETE_PROJECT",
	"CREATE_TAG",
	"UPDATE_TAG",
	"DELETE_TAG",
	"CREATE_GOAL",
	"UPDATE_GOAL",
	"DELETE_GOAL",
	"CREATE_MILESTONE",
	"UPDATE_MILESTONE",
	"DELETE_MILESTONE",
	"CREATE_CHECKLIST",
	"UPDATE_CHECKLIST",
	"DELETE_CHECKLIST",
	// v2.4 (task A4.5) — audit row for every stage transition, gated or
	// overridden. Written regardless of auth_channel so the AI Activity Feed
	// (`channel` column) can distinguish an agent-driven override.
	"ADVANCE_STAGE",
] as const;

export type ActionType = (typeof ACTIONS)[number];

export const action = sqliteTable("action", {
	...owned_entity("action"),
	type: text("type", { enum: ACTIONS }).notNull(),
	description: text("description").notNull(),
	data: text("data", { mode: "json" }),
	channel: text("channel", { enum: ["user", "api"] })
		.notNull()
		.default("user"),
});

export const tracker_result = sqliteTable("tracker_result", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	project_id: text("project_id")
		.notNull()
		.references(() => project.id),
	created_at: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	data: text("data", { mode: "json" }).notNull(),
	accepted: integer("accepted", { mode: "boolean" }).notNull().default(false),
});

export const todo_updates = sqliteTable("todo_updates", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	project_id: text("project_id")
		.notNull()
		.references(() => project.id),
	created_at: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	old_id: integer("old_id").references(() => tracker_result.id),
	new_id: integer("new_id")
		.notNull()
		.references(() => tracker_result.id),
	data: text("data", { mode: "json" }).notNull(),
	status: text("status", { enum: ["PENDING", "ACCEPTED", "REJECTED", "IGNORED"] })
		.notNull()
		.default("PENDING"),
	branch: text("branch"),
	commit_sha: text("commit_sha"),
	commit_msg: text("commit_msg"),
	commit_url: text("commit_url"),
});

export const update_tracker_relations = relations(todo_updates, ({ one }) => ({
	old: one(tracker_result, { fields: [todo_updates.old_id], references: [tracker_result.id] }),
	new: one(tracker_result, { fields: [todo_updates.new_id], references: [tracker_result.id] }),
}));

export const milestone = sqliteTable("milestone", {
	...entity("milestone"),
	project_id: text("project_id")
		.notNull()
		.references(() => project.id),
	name: text("name").notNull(),
	description: text("description"),
	target_time: text("target_time"),
	target_version: text("target_version"),
	finished_at: text("finished_at"),
	after_id: text("after_id"),
});

export const goal = sqliteTable("goal", {
	...entity("goal"),
	milestone_id: text("milestone_id")
		.notNull()
		.references(() => milestone.id),
	name: text("name").notNull(),
	description: text("description"),
	target_time: text("target_time"),
	finished_at: text("finished_at"),
});

// ---------------------------------------------------------------------------
// v2.4 graph primitives — hierarchy/ordering/OCC columns on `task`, the
// single typed edge table, rollup cache, and apply idempotency ledger.
// ---------------------------------------------------------------------------

export const GRAPH_DEPTH_CAP = 8;
export const GRAPH_CHILDREN_CAP = 100;

export const TASK_KINDS = ["task", "phase", "approval"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export const COMPLETION_POLICIES = ["manual", "auto_children"] as const;
export type CompletionPolicy = (typeof COMPLETION_POLICIES)[number];

export const COMPLETED_VIA_VALUES = ["user", "api", "policy"] as const;
export type CompletedVia = (typeof COMPLETED_VIA_VALUES)[number];

export const TASK_LINK_KINDS = ["blocks", "relates_to", "references", "discovered_from", "tracks_metric"] as const;
export type TaskLinkKind = (typeof TASK_LINK_KINDS)[number];

// v2.4 (task A4.5) — SDLC stage enum. `null` (the column default) means "not
// an SDLC-tracked node" — most tasks never opt in. `advance()` in
// `packages/core/src/services/docs/stage.ts` owns every transition.
export const SDLC_STAGES = ["ideate", "plan", "build", "review", "deploy", "live"] as const;
export type SdlcStage = (typeof SDLC_STAGES)[number];

export const task = sqliteTable(
	"task",
	{
		...owned_entity("task"),
		title: text("title").notNull(),
		progress: text("progress", { enum: ["UNSTARTED", "IN_PROGRESS", "COMPLETED"] })
			.notNull()
			.default("UNSTARTED"),
		visibility: text("visibility", { enum: ["PUBLIC", "PRIVATE", "HIDDEN", "ARCHIVED", "DRAFT", "DELETED"] })
			.notNull()
			.default("PRIVATE"),
		goal_id: text("goal_id").references(() => goal.id),
		project_id: text("project_id").references(() => project.id),
		description: text("description"),
		start_time: text("start_time"),
		end_time: text("end_time"),
		summary: text("summary"),
		codebase_task_id: text("codebase_task_id").references(() => codebase_tasks.id),
		priority: text("priority", { enum: ["LOW", "MEDIUM", "HIGH"] })
			.notNull()
			.default("LOW"),
		// graph columns (v2.4) — self-FK omitted deliberately (mirrors
		// checklist_item.parent_id): guarded writes in the graph service own
		// the invariant, not a DB-level FK constraint.
		parent_id: text("parent_id"),
		rank: text("rank").notNull().default(""),
		rev: integer("rev").notNull().default(0),
		kind: text("kind", { enum: TASK_KINDS }).notNull().default("task"),
		completion_policy: text("completion_policy", { enum: COMPLETION_POLICIES }).notNull().default("manual"),
		completed_via: text("completed_via", { enum: COMPLETED_VIA_VALUES }),
		claimed_by: text("claimed_by"),
		claimed_at: text("claimed_at"),
		// v2.4 (task A4.5) — nullable: opting a task into SDLC stage tracking is
		// per-task, not a blanket migration.
		stage: text("stage", { enum: SDLC_STAGES }),
	},
	table => [index("task_parent_id_idx").on(table.parent_id)],
);

export const task_link = sqliteTable(
	"task_link",
	{
		...entity("link"),
		src_id: text("src_id")
			.notNull()
			.references(() => task.id),
		dst_id: text("dst_id").references(() => task.id),
		kind: text("kind", { enum: TASK_LINK_KINDS }).notNull(),
		ref: text("ref", { mode: "json" }),
		note: text("note"),
	},
	table => [
		unique("task_link_unique").on(table.src_id, table.dst_id, table.kind),
		index("task_link_src_id_idx").on(table.src_id),
		index("task_link_dst_id_idx").on(table.dst_id),
	],
);

export const task_rollup = sqliteTable("task_rollup", {
	task_id: text("task_id")
		.primaryKey()
		.references(() => task.id),
	direct_done: integer("direct_done").notNull().default(0),
	direct_total: integer("direct_total").notNull().default(0),
	subtree_done: integer("subtree_done").notNull().default(0),
	subtree_total: integer("subtree_total").notNull().default(0),
});

export const apply_log = sqliteTable("apply_log", {
	idempotency_key: text("idempotency_key").primaryKey(),
	owner_id: text("owner_id")
		.notNull()
		.references(() => user.id),
	response: text("response", { mode: "json" }).notNull(),
	created_at: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
});

// task_event — the transactional outbox every graph mutation writes through
// (task A2.1). Every A1 structural/field mutation pairs its state change
// with exactly one row here, written atomically via `run_atomic` — see
// `packages/core/src/services/graph/outbox.ts` for the emission helper and
// AGENTS.md for the D1-atomicity caveat this inherits from `run_atomic`.
export const TASK_EVENT_KINDS = [
	"task.created",
	"task.updated",
	"task.completed",
	"task.reopened",
	"task.claimed",
	"edge.created",
	"edge.removed",
	"node.children_all_done",
	"policy.fired",
	"node.completion_stale",
	// v2.4 (task A4) — docs/annotation/signoff/stage events. Hooks can bind to
	// any of these exactly like a graph event; no new dispatch machinery.
	"doc.pushed",
	"thread.opened",
	"thread.resolved",
	"signoff.requested",
	"signoff.decided",
	"stage.advanced",
] as const;
export type TaskEventKind = (typeof TASK_EVENT_KINDS)[number];

export const TASK_EVENT_ACTORS = ["user", "api", "policy", "github"] as const;
export type TaskEventActor = (typeof TASK_EVENT_ACTORS)[number];

export const TASK_EVENT_DISPATCH_STATUSES = ["pending", "dispatched"] as const;
export type TaskEventDispatchStatus = (typeof TASK_EVENT_DISPATCH_STATUSES)[number];

export const task_event = sqliteTable(
	"task_event",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		event_id: text("event_id")
			.notNull()
			.unique()
			.$defaultFn(() => `evt_${crypto.randomUUID()}`),
		kind: text("kind", { enum: TASK_EVENT_KINDS }).notNull(),
		subject_id: text("subject_id").notNull(),
		project_id: text("project_id"),
		actor: text("actor", { enum: TASK_EVENT_ACTORS }).notNull(),
		payload: text("payload", { mode: "json" }).notNull(),
		occurred_at: text("occurred_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
		dispatch_status: text("dispatch_status", { enum: TASK_EVENT_DISPATCH_STATUSES }).notNull().default("pending"),
		dispatched_at: text("dispatched_at"),
	},
	(table) => [
		index("task_event_subject_id_idx").on(table.subject_id),
		index("task_event_dispatch_status_idx").on(table.dispatch_status),
	],
);

// ---------------------------------------------------------------------------
// v2.4 hooks (task A3.2) — project-scoped automation: a `hook` matches a set
// of task_event kinds (+ optional selector) and fires an action (webhook /
// vault / pipeline). `hook_delivery` is the idempotency ledger: its PK is a
// deterministic hash of (event_id, hook_id), so replaying the same queue
// message twice is a no-op INSERT OR IGNORE rather than app-level dedup.
// ---------------------------------------------------------------------------

export const hook = sqliteTable(
	"hook",
	{
		...entity("hook"),
		project_id: text("project_id")
			.notNull()
			.references(() => project.id),
		enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
		// HookTrigger: { kinds: TaskEventKind[], selector: { subject_kind?, tag?, ancestor_id? } }
		trigger: text("trigger", { mode: "json" }).notNull(),
		// HookAction: { kind: "webhook", url, secret_encrypted? } | { kind: "vault", scope, op, args? } | { kind: "pipeline", package_id }
		action: text("action", { mode: "json" }).notNull(),
	},
	(table) => [index("hook_project_id_idx").on(table.project_id)],
);

export const HOOK_DELIVERY_STATUSES = ["pending", "delivered", "failed_transient", "failed_permanent"] as const;
export type HookDeliveryStatus = (typeof HOOK_DELIVERY_STATUSES)[number];

export const hook_delivery = sqliteTable(
	"hook_delivery",
	{
		// PK = sha256(`${event_id}:${hook_id}`) — see hooks/dispatch.ts's
		// `hook_delivery_id`. Never generated any other way.
		id: text("id").primaryKey(),
		hook_id: text("hook_id")
			.notNull()
			.references(() => hook.id),
		event_id: text("event_id").notNull(),
		status: text("status", { enum: HOOK_DELIVERY_STATUSES }).notNull().default("pending"),
		attempts: integer("attempts").notNull().default(0),
		last_error: text("last_error"),
		...timestamps(),
	},
	(table) => [
		index("hook_delivery_hook_id_idx").on(table.hook_id),
		index("hook_delivery_status_idx").on(table.status),
	],
);

// ---------------------------------------------------------------------------
// v2.4 GitHub App inbound (task A3.6) — idempotency ledger for the webhook
// receiver. PK = sha256(`${delivery_guid}:${raw_body}`), copying the
// pipelines `events.ts` content-hash pattern: GitHub's own delivery GUID
// dedupes retries of the SAME payload, and the content hash catches the
// (rare) case of GitHub reusing a GUID with different content.
// ---------------------------------------------------------------------------

export const github_webhook_event = sqliteTable(
	"github_webhook_event",
	{
		id: text("id").primaryKey(),
		delivery_guid: text("delivery_guid").notNull(),
		event_type: text("event_type").notNull(),
		processed_at: text("processed_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	},
	(table) => [index("github_webhook_event_delivery_guid_idx").on(table.delivery_guid)],
);

// ---------------------------------------------------------------------------
// v2.4 docs + annotations + signoff (task A4) — the human-in-the-loop
// backend. `document` rows are a thin DB-side index over corpus-versioned
// HTML content (the annotated doc IS the artifact, per the locked decision);
// `annotation_thread` is a REBUILDABLE cache of the thread markers embedded
// in the head version's HTML — never a second source of truth, always
// reconstructible from the doc itself (`packages/core/src/services/docs/threads.ts`);
// `signoff` is the generalized human-approval ledger a `kind:"approval"`
// task node projects into the graph.
// ---------------------------------------------------------------------------

export const DOCUMENT_KINDS = ["plan", "design", "interface"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_STATUSES = ["draft", "in_review", "approved"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const document = sqliteTable(
	"document",
	{
		...entity("doc"),
		project_id: text("project_id")
			.notNull()
			.references(() => project.id),
		// Nullable subject node — a doc need not be tied to a specific task
		// (e.g. a project-level design doc).
		task_id: text("task_id").references(() => task.id),
		kind: text("kind", { enum: DOCUMENT_KINDS }).notNull(),
		title: text("title").notNull(),
		// Corpus version pointer cache — the DB never stores content, only the
		// latest corpus snapshot version for this document's dedicated store
		// (`docStoreId`). Null until the first push.
		head_version: text("head_version"),
		status: text("status", { enum: DOCUMENT_STATUSES }).notNull().default("draft"),
	},
	table => [index("document_project_id_idx").on(table.project_id), index("document_task_id_idx").on(table.task_id)],
);

export const THREAD_STATUSES = ["open", "addressed", "resolved", "orphaned"] as const;
export type ThreadStatus = (typeof THREAD_STATUSES)[number];

export const annotation_thread = sqliteTable(
	"annotation_thread",
	{
		...id("thread"),
		document_id: text("document_id")
			.notNull()
			.references(() => document.id),
		// The marker's own `id` field (embedded in the doc) — stable across
		// versions/re-anchoring, distinct from this row's own DB id.
		thread_id: text("thread_id").notNull(),
		status: text("status", { enum: THREAD_STATUSES }).notNull().default("open"),
		blocking: int("blocking", { mode: "boolean" }).notNull().default(false),
		...timestamps(),
	},
	table => [
		unique("annotation_thread_unique").on(table.document_id, table.thread_id),
		index("annotation_thread_document_id_idx").on(table.document_id),
		index("annotation_thread_status_idx").on(table.status),
	],
);

export const SIGNOFF_SUBJECT_KINDS = ["doc_version", "stage", "pipeline_gate"] as const;
export type SignoffSubjectKind = (typeof SIGNOFF_SUBJECT_KINDS)[number];

export const SIGNOFF_CHECKPOINTS = ["plan", "types", "design"] as const;
export type SignoffCheckpoint = (typeof SIGNOFF_CHECKPOINTS)[number];

export const SIGNOFF_DECISIONS = ["approved", "changes_requested", "auto"] as const;
export type SignoffDecision = (typeof SIGNOFF_DECISIONS)[number];

export const signoff = sqliteTable(
	"signoff",
	{
		...entity("signoff"),
		subject_kind: text("subject_kind", { enum: SIGNOFF_SUBJECT_KINDS }).notNull(),
		subject_id: text("subject_id").notNull(),
		checkpoint: text("checkpoint", { enum: SIGNOFF_CHECKPOINTS }).notNull(),
		// The `kind:"approval"` task node this checkpoint projects into the
		// graph — null only for the brief window before `request_checkpoint`
		// finishes creating it (never persisted mid-transaction in practice).
		task_id: text("task_id").references(() => task.id),
		decision: text("decision", { enum: SIGNOFF_DECISIONS }),
		decided_by: text("decided_by").references(() => user.id),
		decided_at: text("decided_at"),
		reason: text("reason"),
		content_hash: text("content_hash"),
	},
	table => [
		index("signoff_subject_idx").on(table.subject_kind, table.subject_id),
		index("signoff_task_id_idx").on(table.task_id),
	],
);

export const checklist = sqliteTable("checklist", {
	...entity("checklist"),
	task_id: text("task_id")
		.notNull()
		.references(() => task.id),
	name: text("name").notNull(),
});

export const checklist_item = sqliteTable("checklist_item", {
	...entity("checklist-item"),
	checklist_id: text("checklist_id")
		.notNull()
		.references(() => checklist.id),
	parent_id: text("parent_id"),
	name: text("name").notNull(),
	checked: int("checked", { mode: "boolean" }).notNull().default(false),
});

export const codebase_tasks = sqliteTable("codebase_tasks", {
	...entity("codebase-task"),
	branch: text("branch"),
	commit_sha: text("commit_sha"),
	commit_msg: text("commit_msg"),
	commit_url: text("commit_url"),
	type: text("type"),
	text: text("text"),
	file: text("file"),
	line: integer("line"),
	context: text("context", { mode: "json" }),
	recent_scan_id: integer("recent_scan_id").references(() => tracker_result.id),
});

export const tag = sqliteTable(
	"tag",
	{
		...owned_entity("tag"),
		title: text("title").notNull(),
		color: text("color"),
		render: int("render", { mode: "boolean" }).notNull().default(true),
	},
	table => [unique("tag_unique").on(table.owner_id, table.title)]
);

export const task_tag = sqliteTable(
	"task_tag",
	{
		task_id: text("task_id")
			.notNull()
			.references(() => task.id),
		tag_id: text("tag_id")
			.notNull()
			.references(() => tag.id),
		...timestamps(),
	},
	table => [primaryKey({ columns: [table.task_id, table.tag_id] })]
);

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

export const tag_config = sqliteTable("tag_config", {
	...id("tag_config"),
	project_id: text("project_id")
		.notNull()
		.references(() => project.id), // Foreign key to projects
	tag_id: text("tag_id")
		.notNull()
		.references(() => tag.id), // Foreign key to tags
	match: text("match").notNull(), // Match pattern for this tag
	...timestamps(),
});

export const ignore_path = sqliteTable("ignore_path", {
	...id("ignore_path"),
	project_id: text("project_id")
		.notNull()
		.references(() => project.id), // Foreign key to projects
	path: text("path").notNull(), // Ignore path
	...timestamps(),
});

// ---------------------------------------------------------------------------
// devpad/pipelines — deployment-pipeline data model (Phase 0)
// ---------------------------------------------------------------------------

export const ROLLOUT_SHAPES = ["gradual", "atomic"] as const;
export type RolloutShape = (typeof ROLLOUT_SHAPES)[number];

export const RUN_KINDS = ["deploy", "rollback"] as const;
export type RunKind = (typeof RUN_KINDS)[number];

export const RUN_STATUSES = ["queued", "deploying", "baking", "awaiting_approval", "rolling_back", "completed", "rolled_back", "failed", "cancelled"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const FORCED_ATOMIC_REASONS = ["do_migrations", "asset_affinity_none"] as const;
export type ForcedAtomicReason = (typeof FORCED_ATOMIC_REASONS)[number];

export const STAGE_EVENT_KINDS = ["deploy_started", "deploy_completed", "bake_started", "bake_completed", "gate_verdict", "approval_requested", "rollback_started", "rollback_completed", "warning", "error"] as const;
export type StageEventKind = (typeof STAGE_EVENT_KINDS)[number];

export const APPROVAL_DECISIONS = ["approved", "denied"] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

export const pipeline_package = sqliteTable("pipeline_package", {
	...entity("pipeline-package"),
	owner_id: text("owner_id")
		.notNull()
		.references(() => user.id),
	name: text("name").notNull(),
	repo_url: text("repo_url"),
	default_template_ref: text("default_template_ref"),
	script_name_overrides: text("script_name_overrides", { mode: "json" }),
	project_id: text("project_id").references(() => project.id),
});

export const pipeline_run = sqliteTable("pipeline_run", {
	...entity("pipeline-run"),
	package_id: text("package_id")
		.notNull()
		.references(() => pipeline_package.id),
	version_set_id: text("version_set_id").notNull(),
	shape: text("shape", { enum: ROLLOUT_SHAPES }).notNull(),
	kind: text("kind", { enum: RUN_KINDS }).notNull().default("deploy"),
	status: text("status", { enum: RUN_STATUSES }).notNull().default("queued"),
	current_stage: text("current_stage"),
	resolved_rollout: text("resolved_rollout", { mode: "json" }).notNull(),
	resolved_gates: text("resolved_gates", { mode: "json" }).notNull(),
	forced_atomic_reason: text("forced_atomic_reason", { enum: FORCED_ATOMIC_REASONS }),
	started_at: text("started_at"),
	finished_at: text("finished_at"),
});

export const pipeline_stage_event = sqliteTable("pipeline_stage_event", {
	...id("pipeline-stage-event"),
	run_id: text("run_id")
		.notNull()
		.references(() => pipeline_run.id),
	stage_name: text("stage_name").notNull(),
	kind: text("kind", { enum: STAGE_EVENT_KINDS }).notNull(),
	payload: text("payload", { mode: "json" }),
	ts: text("ts").notNull().default(sql`(CURRENT_TIMESTAMP)`),
	idempotency_hash: text("idempotency_hash"),
});

export const pipeline_grant = sqliteTable("pipeline_grant", {
	...entity("pipeline-grant"),
	package_id: text("package_id")
		.notNull()
		.references(() => pipeline_package.id),
	stage_name: text("stage_name").notNull(),
	scope: text("scope").notNull(),
	granted_by: text("granted_by").references(() => user.id),
	granted_at: text("granted_at"),
});

export const pipeline_approval = sqliteTable("pipeline_approval", {
	...id("pipeline-approval"),
	run_id: text("run_id")
		.notNull()
		.references(() => pipeline_run.id),
	stage_name: text("stage_name").notNull(),
	decision: text("decision", { enum: APPROVAL_DECISIONS }),
	reason: text("reason"),
	decided_by: text("decided_by").references(() => user.id),
	decided_at: text("decided_at"),
	...timestamps(),
});

export const pipeline_analysis_template = sqliteTable("pipeline_analysis_template", {
	...entity("pipeline-analysis-template"),
	owner_id: text("owner_id")
		.notNull()
		.references(() => user.id),
	name: text("name").notNull(),
	query_dsl: text("query_dsl", { mode: "json" }).notNull(),
	threshold_dsl: text("threshold_dsl", { mode: "json" }).notNull(),
	window_ms: integer("window_ms").notNull().default(600_000),
});

export const PIPELINE_OIDC_PROVIDERS = ["github"] as const;
export type PipelineOidcProvider = (typeof PIPELINE_OIDC_PROVIDERS)[number];

export const pipeline_oidc_trust = sqliteTable("pipeline_oidc_trust", {
	...entity("pipeline-oidc-trust"),
	owner_id: text("owner_id")
		.notNull()
		.references(() => user.id),
	provider: text("provider", { enum: PIPELINE_OIDC_PROVIDERS }).notNull().default("github"),
	github_owner: text("github_owner").notNull(),
	repo_pattern: text("repo_pattern").notNull().default("*"),
	allowed_refs: text("allowed_refs", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
	allowed_environments: text("allowed_environments", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
	expected_audience: text("expected_audience").notNull(),
	allowed_actions: text("allowed_actions", { mode: "json" }).$type<string[]>().notNull().default(sql`'["artifacts:upload","runs:start"]'`),
	session_ttl_seconds: integer("session_ttl_seconds").notNull().default(900),
	last_used_at: text("last_used_at"),
});

// relations

export const user_relations = relations(user, ({ many }) => ({
	sessions: many(session),
	api_keys: many(api_keys),
	actions: many(action),
	tasks: many(task),
	tags: many(tag),
}));

export const session_relations = relations(session, ({ one }) => ({
	user: one(user, { fields: [session.userId], references: [user.id] }),
}));

export const api_keys_relations = relations(api_keys, ({ one }) => ({
	owner: one(user, { fields: [api_keys.user_id], references: [user.id] }),
}));

export const project_relations = relations(project, ({ one, many }) => ({
	owner: one(user, { fields: [project.owner_id], references: [user.id] }),
	tracker_results: many(tracker_result),
	milestones: many(milestone),
	todo_updates: many(todo_updates),
}));

export const action_relations = relations(action, ({ one }) => ({
	owner: one(user, { fields: [action.owner_id], references: [user.id] }),
}));

export const tracker_result_relations = relations(tracker_result, ({ one }) => ({
	project: one(project, { fields: [tracker_result.project_id], references: [project.id] }),
}));

export const todoUpdatesRelations = relations(todo_updates, ({ one }) => ({
	project: one(project, { fields: [todo_updates.project_id], references: [project.id] }),
	oldTrackerResult: one(tracker_result, { fields: [todo_updates.old_id], references: [tracker_result.id] }),
	newTrackerResult: one(tracker_result, { fields: [todo_updates.new_id], references: [tracker_result.id] }),
}));

export const milestone_relations = relations(milestone, ({ one, many }) => ({
	project: one(project, { fields: [milestone.project_id], references: [project.id] }),
	goals: many(goal),
}));

export const goal_relations = relations(goal, ({ one }) => ({
	milestone: one(milestone, { fields: [goal.milestone_id], references: [milestone.id] }),
}));

export const task_relations = relations(task, ({ one, many }) => ({
	owner: one(user, { fields: [task.owner_id], references: [user.id] }),
	goal: one(goal, { fields: [task.goal_id], references: [goal.id] }),
	codebase_task: one(codebase_tasks, { fields: [task.codebase_task_id], references: [codebase_tasks.id] }),
	checklists: many(checklist),
	outgoing_links: many(task_link, { relationName: "task_link_src" }),
	incoming_links: many(task_link, { relationName: "task_link_dst" }),
	rollup: one(task_rollup, { fields: [task.id], references: [task_rollup.task_id] }),
}));

export const task_link_relations = relations(task_link, ({ one }) => ({
	src: one(task, { fields: [task_link.src_id], references: [task.id], relationName: "task_link_src" }),
	dst: one(task, { fields: [task_link.dst_id], references: [task.id], relationName: "task_link_dst" }),
}));

export const task_rollup_relations = relations(task_rollup, ({ one }) => ({
	task: one(task, { fields: [task_rollup.task_id], references: [task.id] }),
}));

export const task_event_relations = relations(task_event, ({ one }) => ({
	subject: one(task, { fields: [task_event.subject_id], references: [task.id] }),
}));

export const hook_relations = relations(hook, ({ one, many }) => ({
	project: one(project, { fields: [hook.project_id], references: [project.id] }),
	deliveries: many(hook_delivery),
}));

export const hook_delivery_relations = relations(hook_delivery, ({ one }) => ({
	hook: one(hook, { fields: [hook_delivery.hook_id], references: [hook.id] }),
}));

export const checklist_relations = relations(checklist, ({ one, many }) => ({
	task: one(task, { fields: [checklist.task_id], references: [task.id] }),
	items: many(checklist_item),
}));

export const checklist_item_relations = relations(checklist_item, ({ one }) => ({
	checklist: one(checklist, { fields: [checklist_item.checklist_id], references: [checklist.id] }),
}));

export const tag_relations = relations(tag, ({ one }) => ({
	owner: one(user, { fields: [tag.owner_id], references: [user.id] }),
}));

export const task_tag_relations = relations(task_tag, ({ one }) => ({
	task: one(task, { fields: [task_tag.task_id], references: [task.id] }),
	tag: one(tag, { fields: [task_tag.tag_id], references: [tag.id] }),
}));

export const pipeline_package_relations = relations(pipeline_package, ({ one, many }) => ({
	owner: one(user, { fields: [pipeline_package.owner_id], references: [user.id] }),
	runs: many(pipeline_run),
	grants: many(pipeline_grant),
}));

export const pipeline_run_relations = relations(pipeline_run, ({ one, many }) => ({
	package: one(pipeline_package, { fields: [pipeline_run.package_id], references: [pipeline_package.id] }),
	events: many(pipeline_stage_event),
	approvals: many(pipeline_approval),
}));

export const pipeline_stage_event_relations = relations(pipeline_stage_event, ({ one }) => ({
	run: one(pipeline_run, { fields: [pipeline_stage_event.run_id], references: [pipeline_run.id] }),
}));

export const pipeline_grant_relations = relations(pipeline_grant, ({ one }) => ({
	package: one(pipeline_package, { fields: [pipeline_grant.package_id], references: [pipeline_package.id] }),
	granted_by_user: one(user, { fields: [pipeline_grant.granted_by], references: [user.id] }),
}));

export const pipeline_approval_relations = relations(pipeline_approval, ({ one }) => ({
	run: one(pipeline_run, { fields: [pipeline_approval.run_id], references: [pipeline_run.id] }),
	decided_by_user: one(user, { fields: [pipeline_approval.decided_by], references: [user.id] }),
}));

export const pipeline_analysis_template_relations = relations(pipeline_analysis_template, ({ one }) => ({
	owner: one(user, { fields: [pipeline_analysis_template.owner_id], references: [user.id] }),
}));

export const pipeline_oidc_trust_relations = relations(pipeline_oidc_trust, ({ one }) => ({
	owner: one(user, { fields: [pipeline_oidc_trust.owner_id], references: [user.id] }),
}));

export const document_relations = relations(document, ({ one, many }) => ({
	project: one(project, { fields: [document.project_id], references: [project.id] }),
	task: one(task, { fields: [document.task_id], references: [task.id] }),
	threads: many(annotation_thread),
}));

export const annotation_thread_relations = relations(annotation_thread, ({ one }) => ({
	document: one(document, { fields: [annotation_thread.document_id], references: [document.id] }),
}));

export const signoff_relations = relations(signoff, ({ one }) => ({
	task: one(task, { fields: [signoff.task_id], references: [task.id] }),
	decided_by_user: one(user, { fields: [signoff.decided_by], references: [user.id] }),
}));
