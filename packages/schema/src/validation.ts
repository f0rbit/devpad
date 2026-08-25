import { z } from "zod";
import { COMPLETED_VIA_VALUES, COMPLETION_POLICIES, STAGE_EVENT_KINDS, TASK_EVENT_ACTORS, TASK_LINK_KINDS } from "./database/schema.js";

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
]);
export type TaskEventPayload = z.infer<typeof task_event_payload>;
