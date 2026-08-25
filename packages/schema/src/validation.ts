import { z } from "zod";
import {
	COMPLETED_VIA_VALUES,
	COMPLETION_POLICIES,
	DOCUMENT_KINDS,
	SDLC_STAGES,
	SIGNOFF_CHECKPOINTS,
	SIGNOFF_DECISIONS,
	SIGNOFF_SUBJECT_KINDS,
	STAGE_EVENT_KINDS,
	TASK_EVENT_ACTORS,
	TASK_EVENT_KINDS,
	TASK_KINDS,
	TASK_LINK_KINDS,
	THREAD_STATUSES,
} from "./database/schema.js";

export const upsert_project = z.object({
	id: z.string().optional().nullable(),
	project_id: z.string(),
	owner_id: z.string().optional(),
	name: z.string(),
	description: z.string().nullable(),
	specification: z.string().nullable(),
	repo_url: z.string().nullable(),
	repo_id: z.number().nullable(),
	icon_url: z.string().nullable(),
	status: z
		.union([
			z.literal("DEVELOPMENT"),
			z.literal("PAUSED"),
			z.literal("RELEASED"),
			z.literal("LIVE"),
			z.literal("FINISHED"),
			z.literal("ABANDONED"),
			z.literal("STOPPED"),
		])
		.optional(),
	deleted: z.boolean().optional().default(false),
	link_url: z.string().nullable(),
	link_text: z.string().nullable(),
	visibility: z
		.union([
			z.literal("PUBLIC"),
			z.literal("PRIVATE"),
			z.literal("HIDDEN"),
			z.literal("ARCHIVED"),
			z.literal("DRAFT"),
			z.literal("DELETED"),
		])
		.optional(),
	current_version: z.string().nullable(),
	force: z.boolean().optional().describe("Override protection on user-modified entities"),
});

export const upsert_todo = z.object({
	id: z.string().optional().nullable(),
	title: z.string().optional(),
	summary: z.string().optional().nullable(),
	description: z.string().optional().nullable(),
	progress: z.union([z.literal("UNSTARTED"), z.literal("IN_PROGRESS"), z.literal("COMPLETED")]).optional(),
	visibility: z
		.union([
			z.literal("PUBLIC"),
			z.literal("PRIVATE"),
			z.literal("HIDDEN"),
			z.literal("ARCHIVED"),
			z.literal("DRAFT"),
			z.literal("DELETED"),
		])
		.optional(),
	start_time: z.string().optional().nullable(),
	end_time: z.string().optional().nullable(),
	priority: z.union([z.literal("LOW"), z.literal("MEDIUM"), z.literal("HIGH")]).optional(),
	owner_id: z.string(),
	project_id: z.string().optional().nullable(),
	goal_id: z.string().optional().nullable(),
	// v2.4 graph fields. `completed_via` is deliberately absent — it's
	// engine-owned (CompletionEngine, phase A2) and must never be settable
	// from client input.
	parent_id: z.string().optional().nullable(),
	rank: z.string().optional(),
	kind: z.union([z.literal("task"), z.literal("phase"), z.literal("approval")]).optional(),
	completion_policy: z.union([z.literal("manual"), z.literal("auto_children")]).optional(),
	force: z.boolean().optional().describe("Override protection on user-modified entities"),
});

export const update_action = z.union([
	z.literal("CONFIRM"),
	z.literal("UNLINK"),
	z.literal("CREATE"),
	z.literal("IGNORE"),
	z.literal("DELETE"),
	z.literal("COMPLETE"),
]);

export const upsert_tag = z.object({
	id: z.string().optional(),
	title: z.string(),
	color: z
		.union([
			z.literal("red"),
			z.literal("green"),
			z.literal("blue"),
			z.literal("yellow"),
			z.literal("purple"),
			z.literal("orange"),
			z.literal("teal"),
			z.literal("pink"),
			z.literal("gray"),
			z.literal("cyan"),
			z.literal("lime"),
		])
		.nullable()
		.optional(),
	deleted: z.boolean().optional().default(false),
	render: z.boolean().optional().default(true),
	owner_id: z.string(),
});

export const project_config = z.object({
	tags: z.array(
		z.object({
			name: z.string(),
			match: z.array(z.string()),
		}),
	),
	ignore: z.array(z.string()),
});

export const save_config_request = z.object({
	id: z.string(),
	config: project_config,
	scan_branch: z.string().optional(),
});

export const save_tags_request = z.array(upsert_tag);

export const update_user = z.object({
	id: z.string(),
	name: z.string().optional(),
	image_url: z.string().optional(),
	task_view: z.union([z.literal("list"), z.literal("grid")]).optional(),
	email_verified: z.boolean().optional(),
});

export const config_schema = z.object({
	tags: z.array(
		z.object({
			name: z.string(),
			match: z.array(z.string()),
		}),
	),
	ignore: z.array(z.string().regex(/^[\s\S]*$/, "Invalid path")),
});

export const upsert_milestone = z.object({
	id: z.string().optional().nullable(),
	project_id: z.string(),
	name: z.string().min(1).max(200),
	description: z.string().nullable().optional(),
	target_time: z.string().nullable().optional(),
	target_version: z.string().nullable().optional(),
	finished_at: z.string().nullable().optional(),
	after_id: z.string().nullable().optional(),
	force: z.boolean().optional().describe("Override protection on user-modified entities"),
});

export const upsert_goal = z.object({
	id: z.string().optional().nullable(),
	milestone_id: z.string(),
	name: z.string().min(1).max(200),
	description: z.string().nullable().optional(),
	target_time: z.string().nullable().optional(),
	finished_at: z.string().nullable().optional(),
	force: z.boolean().optional().describe("Override protection on user-modified entities"),
});

// ---------------------------------------------------------------------------
// devpad/pipelines — Zod schemas (Phase 0)
// ---------------------------------------------------------------------------

export const rollout_shape = z.union([z.literal("gradual"), z.literal("atomic")]);
export type RolloutShapeZ = z.infer<typeof rollout_shape>;

export const run_kind = z.union([z.literal("deploy"), z.literal("rollback")]);
export type RunKindZ = z.infer<typeof run_kind>;

export const run_status = z.union([
	z.literal("queued"),
	z.literal("deploying"),
	z.literal("baking"),
	z.literal("awaiting_approval"),
	z.literal("rolling_back"),
	z.literal("completed"),
	z.literal("rolled_back"),
	z.literal("failed"),
	z.literal("cancelled"),
]);

export const forced_atomic_reason = z.union([z.literal("do_migrations"), z.literal("asset_affinity_none")]);

export const stage_event_kind = z.union([
	z.literal("deploy_started"),
	z.literal("deploy_completed"),
	z.literal("bake_started"),
	z.literal("bake_completed"),
	z.literal("gate_verdict"),
	z.literal("approval_requested"),
	z.literal("rollback_started"),
	z.literal("rollback_completed"),
	z.literal("warning"),
	z.literal("error"),
]);

export const approval_decision = z.union([z.literal("approved"), z.literal("denied")]);

// Scope format: {provider}:{action}[:{resource}]  e.g. anthropic:messages, github:read:my-org/*
export const grant_scope = z.string().regex(/^[a-z0-9_-]+:[a-z0-9_-]+(:[^\s]+)?$/, "Invalid scope format");

export const rollout_stage = z.object({
	name: z.string(),
	traffic: z.number().int().min(0).max(100),
	bake: z.string().nullable(),
});

export const resolved_rollout = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("gradual"),
		stages: z.array(rollout_stage),
	}),
	z.object({
		type: z.literal("atomic"),
	}),
]);

export const gate_descriptor = z.discriminatedUnion("type", [
	z.object({ type: z.literal("manual") }),
	z.object({ type: z.literal("auto"), afterBake: z.boolean().optional() }),
	z.object({ type: z.literal("analysis"), template: z.string() }),
]);

export const resolved_gates = z.record(z.string(), gate_descriptor);

export const upsert_pipeline_package = z.object({
	id: z.string().optional().nullable(),
	owner_id: z.string(),
	name: z.string().min(1).max(200),
	repo_url: z.string().nullable().optional(),
	default_template_ref: z.string().nullable().optional(),
	script_name_overrides: z.record(z.string(), z.string()).nullable().optional(),
	project_id: z.string().nullable().optional(),
});

export const upsert_pipeline_run = z.object({
	id: z.string().optional().nullable(),
	package_id: z.string(),
	version_set_id: z.string(),
	shape: rollout_shape,
	kind: run_kind.optional(),
	status: run_status.optional(),
	current_stage: z.string().nullable().optional(),
	resolved_rollout: resolved_rollout,
	resolved_gates: resolved_gates,
	forced_atomic_reason: forced_atomic_reason.nullable().optional(),
	started_at: z.string().nullable().optional(),
	finished_at: z.string().nullable().optional(),
});

export const insert_pipeline_stage_event = z.object({
	run_id: z.string(),
	stage_name: z.string(),
	kind: stage_event_kind,
	payload: z.unknown().optional(),
});

export const upsert_pipeline_grant = z.object({
	id: z.string().optional().nullable(),
	package_id: z.string(),
	stage_name: z.string(),
	scope: grant_scope,
	granted_by: z.string().nullable().optional(),
	granted_at: z.string().nullable().optional(),
});

export const upsert_pipeline_approval = z.object({
	run_id: z.string(),
	stage_name: z.string(),
	decision: approval_decision.nullable().optional(),
	reason: z.string().nullable().optional(),
	decided_by: z.string().nullable().optional(),
	decided_at: z.string().nullable().optional(),
});

export const upsert_pipeline_analysis_template = z.object({
	id: z.string().optional(),
	owner_id: z.string().min(1),
	name: z.string().min(1).max(200),
	query_dsl: z.unknown(),
	threshold_dsl: z.string().min(1),
	window_ms: z.number().int().positive(),
});

export const pipeline_oidc_provider = z.literal("github");

export const upsert_pipeline_oidc_trust = z.object({
	id: z.string().optional().nullable(),
	owner_id: z.string(),
	provider: pipeline_oidc_provider.optional(),
	github_owner: z.string().min(1).max(200),
	repo_pattern: z.string().min(1).max(200).optional(),
	allowed_refs: z.array(z.string()).optional(),
	allowed_environments: z.array(z.string()).optional(),
	expected_audience: z.string().min(1),
	allowed_actions: z.array(z.string()).optional(),
	session_ttl_seconds: z.number().int().positive().optional(),
	last_used_at: z.string().nullable().optional(),
});

// ---------------------------------------------------------------------------
// devpad/pipelines — Phase 2 schemas (webhook events, dashboard)
// ---------------------------------------------------------------------------

export const webhook_event_body = z.object({
	stage_name: z.string().min(1),
	kind: z.enum(STAGE_EVENT_KINDS),
	payload: z.unknown().optional(),
	idempotency_key: z.string().uuid(),
});
export type WebhookEventBody = z.infer<typeof webhook_event_body>;

export const dashboard_window_query = z.object({
	package_id: z.string().min(1),
	window_ms: z
		.number()
		.int()
		.positive()
		.default(24 * 60 * 60 * 1000),
});
export type DashboardWindowQuery = z.infer<typeof dashboard_window_query>;

const verdict_breakdown = z.object({
	pass: z.number().int().nonnegative(),
	fail: z.number().int().nonnegative(),
	pending: z.number().int().nonnegative(),
});

export const dashboard_response = z.object({
	run_counts: z.object({
		total: z.number().int().nonnegative(),
		completed: z.number().int().nonnegative(),
		failed: z.number().int().nonnegative(),
		cancelled: z.number().int().nonnegative(),
		rolled_back: z.number().int().nonnegative(),
		in_flight: z.number().int().nonnegative(),
	}),
	verdict_counts: z.object({
		manual: verdict_breakdown,
		auto: verdict_breakdown,
		analysis: verdict_breakdown,
	}),
	latency_p50_ms: z.number().nonnegative().nullable(),
	latency_p95_ms: z.number().nonnegative().nullable(),
	approval_turnaround_p50_ms: z.number().nonnegative().nullable(),
	rollback_rate: z.number().min(0).max(1).nullable(),
});
export type DashboardResponse = z.infer<typeof dashboard_response>;

// ---------------------------------------------------------------------------
// v2.4 graph primitives — external refs, task_link, batch apply
// ---------------------------------------------------------------------------

export const external_ref = z.discriminatedUnion("type", [
	z.object({ type: z.literal("pr"), url: z.string().min(1) }),
	z.object({ type: z.literal("commit"), sha: z.string().min(1) }),
	z.object({ type: z.literal("file"), path: z.string().min(1) }),
	z.object({ type: z.literal("doc"), doc_id: z.string().min(1) }),
	z.object({ type: z.literal("metric"), name: z.string().min(1) }),
	z.object({ type: z.literal("pipeline_run"), run_id: z.string().min(1) }),
]);

export const task_link_kind = z.enum(TASK_LINK_KINDS);

export const upsert_task_link = z.object({
	id: z.string().optional().nullable(),
	src_id: z.string(),
	dst_id: z.string().nullable().optional(),
	kind: task_link_kind,
	ref: external_ref.nullable().optional(),
	note: z.string().nullable().optional(),
});

// Batch apply (task A1.4) — a Zod discriminated union of graph operations,
// with `$0`/`$1`… temp-handle strings letting one call reference a not-yet-
// created row's id from a later op in the same batch.
export const apply_op = z.discriminatedUnion("op", [
	z.object({
		op: z.literal("create"),
		handle: z.string().optional().describe("Temp handle (e.g. '$0') other ops in this batch may reference"),
		data: upsert_todo,
	}),
	z.object({ op: z.literal("update"), id: z.string(), base_rev: z.number().int(), data: upsert_todo.partial() }),
	z.object({ op: z.literal("reparent"), id: z.string(), parent_id: z.string().nullable(), base_rev: z.number().int() }),
	z.object({ op: z.literal("link"), link: upsert_task_link }),
	z.object({ op: z.literal("unlink"), id: z.string() }),
	z.object({ op: z.literal("claim"), id: z.string(), actor: z.string(), base_rev: z.number().int() }),
	z.object({ op: z.literal("complete"), id: z.string(), base_rev: z.number().int() }),
]);
export type ApplyOp = z.infer<typeof apply_op>;

export const apply_request = z.object({
	idempotency_key: z.string().min(1),
	base_revs: z.record(z.string(), z.number().int()).optional(),
	ops: z.array(apply_op).min(1),
});
export type ApplyRequest = z.infer<typeof apply_request>;

export const claim_request = z.object({ actor: z.string().min(1), base_rev: z.number().int() });
export type ClaimRequest = z.infer<typeof claim_request>;

export const done_request = z.object({ base_rev: z.number().int() });
export type DoneRequest = z.infer<typeof done_request>;

// ---------------------------------------------------------------------------
// task_event outbox payload (task A2.1) — one variant per TASK_EVENT_KINDS
// entry, refined by `kind` so a malformed payload for a given kind is a
// schema rejection, not a silent `unknown`.
// ---------------------------------------------------------------------------

export const task_event_actor = z.enum(TASK_EVENT_ACTORS);

export const task_event_payload = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("task.created"), title: z.string() }),
	z.object({ kind: z.literal("task.updated"), fields: z.array(z.string()) }),
	z.object({ kind: z.literal("task.completed"), via: z.enum(COMPLETED_VIA_VALUES) }),
	z.object({ kind: z.literal("task.reopened"), via: z.enum(COMPLETED_VIA_VALUES) }),
	z.object({ kind: z.literal("task.claimed"), actor: z.string() }),
	z.object({ kind: z.literal("edge.created"), link_kind: task_link_kind, dst_id: z.string().nullable() }),
	z.object({ kind: z.literal("edge.removed"), link_kind: task_link_kind, dst_id: z.string().nullable() }),
	z.object({ kind: z.literal("node.children_all_done") }),
	z.object({ kind: z.literal("policy.fired"), policy: z.enum(COMPLETION_POLICIES) }),
	z.object({ kind: z.literal("node.completion_stale"), child_id: z.string() }),
	z.object({ kind: z.literal("doc.pushed"), document_id: z.string(), version: z.string() }),
	z.object({ kind: z.literal("thread.opened"), document_id: z.string(), thread_id: z.string() }),
	z.object({ kind: z.literal("thread.resolved"), document_id: z.string(), thread_id: z.string() }),
	z.object({
		kind: z.literal("signoff.requested"),
		subject_kind: z.enum(SIGNOFF_SUBJECT_KINDS),
		subject_id: z.string(),
		checkpoint: z.enum(SIGNOFF_CHECKPOINTS),
	}),
	z.object({
		kind: z.literal("signoff.decided"),
		subject_kind: z.enum(SIGNOFF_SUBJECT_KINDS),
		subject_id: z.string(),
		checkpoint: z.enum(SIGNOFF_CHECKPOINTS),
		decision: z.enum(SIGNOFF_DECISIONS),
	}),
	z.object({
		kind: z.literal("stage.advanced"),
		from: z.enum(SDLC_STAGES).nullable(),
		to: z.enum(SDLC_STAGES),
		override: z.boolean(),
	}),
]);
export type TaskEventPayload = z.infer<typeof task_event_payload>;

// ---------------------------------------------------------------------------
// v2.4 docs + annotations + signoff + stage (task A4)
// ---------------------------------------------------------------------------

export const document_kind = z.enum(DOCUMENT_KINDS);

/** Pushes a new corpus version. Omit `document_id` to create a new document. */
export const push_doc_request = z.object({
	document_id: z.string().optional(),
	project_id: z.string(),
	task_id: z.string().nullable().optional(),
	kind: document_kind,
	title: z.string().min(1),
	html: z.string(),
});
export type PushDocRequest = z.infer<typeof push_doc_request>;

// The W3C trifecta anchor (locked decision 3 / option C1) — quote + ~32-char
// prefix/suffix + char offsets, carried redundantly so re-anchoring can
// verify structurally (offsets) and fall back to fuzzy quote matching.
export const thread_anchor = z.object({
	quote: z.string().min(1),
	prefix: z.string(),
	suffix: z.string(),
	start: z.number().int().nonnegative(),
	end: z.number().int().nonnegative(),
});
export type ThreadAnchor = z.infer<typeof thread_anchor>;

export const thread_entry = z.object({
	author: z.string().min(1),
	channel: z.enum(["user", "api"]),
	body: z.string().min(1),
	at: z.string(),
});
export type ThreadEntry = z.infer<typeof thread_entry>;

export const thread_status = z.enum(THREAD_STATUSES);

// The begin-marker's JSON payload — Zod-parsed on every read so a malformed
// or hostile marker becomes a typed orphan, never a crash or code execution.
export const thread_marker = z.object({
	id: z.string().min(1),
	anchor: thread_anchor,
	status: thread_status,
	blocking: z.boolean(),
	entries: z.array(thread_entry).min(1),
});
export type ThreadMarker = z.infer<typeof thread_marker>;

export const create_thread_request = z.object({
	quote: z.string().min(1),
	prefix: z.string(),
	suffix: z.string(),
	start: z.number().int().nonnegative(),
	end: z.number().int().nonnegative(),
	body: z.string().min(1),
	blocking: z.boolean().optional().default(false),
});
export type CreateThreadRequest = z.infer<typeof create_thread_request>;

export const reply_thread_request = z.object({ body: z.string().min(1) });
export type ReplyThreadRequest = z.infer<typeof reply_thread_request>;

export const toggle_blocking_request = z.object({ blocking: z.boolean() });
export type ToggleBlockingRequest = z.infer<typeof toggle_blocking_request>;

export const signoff_subject_kind = z.enum(SIGNOFF_SUBJECT_KINDS);
export const signoff_checkpoint = z.enum(SIGNOFF_CHECKPOINTS);

export const request_checkpoint_request = z.object({
	subject_kind: signoff_subject_kind,
	subject_id: z.string(),
	checkpoint: signoff_checkpoint,
	// Explicit, not inferred (architecture-decisions) — the caller names the
	// downstream task ids this checkpoint's approval node blocks.
	blocks: z.array(z.string()).default([]),
});
export type RequestCheckpointRequest = z.infer<typeof request_checkpoint_request>;

export const decide_checkpoint_request = z.object({
	decision: z.union([z.literal("approved"), z.literal("changes_requested")]),
	reason: z.string().optional(),
});
export type DecideCheckpointRequest = z.infer<typeof decide_checkpoint_request>;

export const sdlc_stage = z.enum(SDLC_STAGES);

export const advance_stage_request = z.object({
	to: sdlc_stage,
	override: z.boolean().optional().default(false),
	reason: z.string().optional(),
});
export type AdvanceStageRequest = z.infer<typeof advance_stage_request>;

// Interface report (task A4.4)
export const push_interface_report_request = z.object({
	project_id: z.string(),
	task_id: z.string().nullable().optional(),
	package_name: z.string().min(1),
	declarations: z.string(),
});
export type PushInterfaceReportRequest = z.infer<typeof push_interface_report_request>;

export const INTERFACE_DIFF_CLASSES = ["additive", "breaking", "unchanged"] as const;
export type InterfaceDiffClass = (typeof INTERFACE_DIFF_CLASSES)[number];

// Reviews-pending aggregate (task A4.6) — one typed shape across all four
// human-attention sources, each carrying enough to deep-link + sort by age.
export const REVIEW_ITEM_KINDS = ["signoff", "annotation", "pipeline_gate", "scan_diff"] as const;
export type ReviewItemKind = (typeof REVIEW_ITEM_KINDS)[number];

export const review_item = z.object({
	kind: z.enum(REVIEW_ITEM_KINDS),
	subject_id: z.string(),
	title: z.string(),
	project_id: z.string().nullable(),
	created_at: z.string(),
	path: z.string(),
});
export type ReviewItem = z.infer<typeof review_item>;

export const reviews_pending_response = z.object({ items: z.array(review_item) });
export type ReviewsPendingResponse = z.infer<typeof reviews_pending_response>;

// ---------------------------------------------------------------------------
// v2.4 hooks (task A3.2) — trigger/action shapes shared by the CRUD route,
// the registry service, and the dispatcher's hook-matching logic.
// ---------------------------------------------------------------------------

export const hook_selector = z.object({
	subject_kind: z.enum(TASK_KINDS).optional(),
	tag: z.string().optional(),
	ancestor_id: z.string().optional(),
});
export type HookSelector = z.infer<typeof hook_selector>;

export const hook_trigger = z.object({
	kinds: z.array(z.enum(TASK_EVENT_KINDS)).min(1),
	selector: hook_selector.default({}),
});
export type HookTrigger = z.infer<typeof hook_trigger>;

/** Write-side action union — callers submit a plaintext `secret`, never `secret_encrypted`. */
export const hook_action_input = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("webhook"), url: z.string().url(), secret: z.string().min(1).optional() }),
	z.object({
		kind: z.literal("vault"),
		scope: z.string().min(1),
		op: z.string().min(1),
		args: z.record(z.string(), z.unknown()).optional(),
	}),
	z.object({ kind: z.literal("pipeline"), package_id: z.string().min(1) }),
]);
export type HookActionInput = z.infer<typeof hook_action_input>;

/** Storage/dispatch-side action union — what's actually persisted in `hook.action`. */
export const hook_action_stored = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("webhook"), url: z.string().url(), secret_encrypted: z.string().optional() }),
	z.object({
		kind: z.literal("vault"),
		scope: z.string().min(1),
		op: z.string().min(1),
		args: z.record(z.string(), z.unknown()).optional(),
	}),
	z.object({ kind: z.literal("pipeline"), package_id: z.string().min(1) }),
]);
export type HookActionStored = z.infer<typeof hook_action_stored>;

/** Read-side action union — what routes return. `secret_encrypted` never leaves the registry. */
export const hook_action_public = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("webhook"), url: z.string().url(), has_secret: z.boolean() }),
	z.object({
		kind: z.literal("vault"),
		scope: z.string().min(1),
		op: z.string().min(1),
		args: z.record(z.string(), z.unknown()).optional(),
	}),
	z.object({ kind: z.literal("pipeline"), package_id: z.string().min(1) }),
]);
export type HookActionPublic = z.infer<typeof hook_action_public>;

export const upsert_hook = z.object({
	id: z.string().optional(),
	project_id: z.string(),
	enabled: z.boolean().default(true),
	trigger: hook_trigger,
	action: hook_action_input,
});
export type UpsertHook = z.infer<typeof upsert_hook>;
