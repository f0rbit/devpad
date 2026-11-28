/**
 * @module schema/pipelines/wire
 *
 * Single Zod source of truth for the pipelines orchestrator's WIRE shapes
 * (verification-hardening 2.2): the `{ ok: true, value } | { ok: false,
 * error: { code, message?, ...details } }` envelope plus the run, run-list,
 * stage-event, grant, package, dispatch-ledger and event-ingest DTOs.
 *
 * Three consumers share it:
 *
 * - the orchestrator (`packages/pipelines/src/routes.ts`) builds responses
 *   through the `wire_*` serialisers, so a drizzle-row / wire-schema drift
 *   is a compile error at those call sites;
 * - the main-Worker proxy (`packages/worker/src/routes/v1/pipelines.ts`)
 *   parses every upstream body with the matching schema and answers 502
 *   `pipelines_contract_violation` on mismatch;
 * - the ApiClient (`packages/api/src/api-client.ts`) parses responses with
 *   the same schemas, the way `client.pulse.*` already does.
 *
 * DTO schemas deliberately mirror the drizzle rows (`@devpad/schema/types`)
 * field-for-field — dates are SQLite text timestamps, `mode: "json"` columns
 * arrive as parsed objects (the 2.1 column schemas are reused directly).
 * The `RowMatches` guard on the serialisers makes a row/wire divergence a
 * compile error, so this file cannot silently rot away from the tables.
 */

import { z } from "zod";
import { ingest_tick } from "../contracts/external-events.js";
import { wire_error } from "../contracts/wire.js";
import type { PipelineDispatch, PipelineGrant, PipelinePackage, PipelineRun, PipelineStageEvent } from "../types.js";
import {
	dashboard_response,
	deploy_mode,
	dispatch_status,
	external_target,
	forced_atomic_reason,
	resolved_gates,
	resolved_rollout,
	rollout_shape,
	run_kind,
	run_status,
	script_name_overrides,
	stage_event_kind,
	stage_event_payload,
} from "../validation.js";

/* ─── Wire envelope ──────────────────────────────────────────────── */

export { wire_error as pipelines_wire_error };
export type PipelinesWireError = z.infer<typeof wire_error>;

export const pipelines_ok_envelope = <T extends z.ZodTypeAny>(value: T) => z.object({ ok: z.literal(true), value });

export const pipelines_wire_envelope = <T extends z.ZodTypeAny>(value: T) =>
	z.discriminatedUnion("ok", [pipelines_ok_envelope(value), wire_error]);

/* ─── Row-column fragments ───────────────────────────────────────── */

const auth_channel_wire = z.union([z.literal("user"), z.literal("api")]);

/** Mirrors `entity()` in `packages/schema/src/database/schema.ts`. */
const wire_entity = {
	id: z.string().min(1),
	created_at: z.string(),
	updated_at: z.string(),
	deleted: z.boolean(),
	created_by: auth_channel_wire,
	modified_by: auth_channel_wire,
	protected: z.boolean(),
};

/* ─── DTO schemas ────────────────────────────────────────────────── */

export const pipeline_run_wire = z.object({
	...wire_entity,
	package_id: z.string().min(1),
	version_set_id: z.string().nullable(),
	commit_sha: z.string().nullable(),
	shape: rollout_shape,
	kind: run_kind,
	status: run_status,
	current_stage: z.string().nullable(),
	resolved_rollout,
	resolved_gates,
	forced_atomic_reason: forced_atomic_reason.nullable(),
	started_at: z.string().nullable(),
	finished_at: z.string().nullable(),
	error: z.string().nullable(),
});

export const pipeline_stage_event_wire = z.object({
	id: z.string().min(1),
	run_id: z.string().min(1),
	stage_name: z.string(),
	kind: stage_event_kind,
	payload: stage_event_payload.nullable(),
	ts: z.string(),
	idempotency_hash: z.string().nullable(),
});

export const pipeline_grant_wire = z.object({
	...wire_entity,
	package_id: z.string().min(1),
	stage_name: z.string(),
	scope: z.string(),
	granted_by: z.string().nullable(),
	granted_at: z.string().nullable(),
	auto_approved: z.boolean(),
});

export const pipeline_package_wire = z.object({
	...wire_entity,
	owner_id: z.string().min(1),
	name: z.string(),
	repo_url: z.string().nullable(),
	default_template_ref: z.string().nullable(),
	script_name_overrides: script_name_overrides.nullable(),
	project_id: z.string().nullable(),
	deploy_mode,
	external_target: external_target.nullable(),
});

export const pipeline_run_list_wire = z.array(pipeline_run_wire);
export const pipeline_stage_event_list_wire = z.array(pipeline_stage_event_wire);
export const pipeline_grant_list_wire = z.array(pipeline_grant_wire);
export const pipeline_package_list_wire = z.array(pipeline_package_wire);

/* ─── Dispatch ledger (`GET /runs/:id/dispatches`, #155) ─────────── */

export const pipeline_dispatch_entry_wire = z.object({
	stage_name: z.string(),
	commit_sha: z.string(),
	status: dispatch_status,
	error: z.string().nullable(),
	requested_by: z.string().nullable(),
	created_at: z.string(),
	updated_at: z.string(),
});

export const pipeline_dispatch_ledger_wire = z.object({
	run_id: z.string().min(1),
	run_status,
	commit_sha: z.string().nullable(),
	dispatches: z.array(pipeline_dispatch_entry_wire),
});

/* ─── Event ingest response (#155 `tick`) ────────────────────────── */

export const pipeline_ingest_response_wire = z.object({
	event_id: z.string().min(1),
	duplicated: z.boolean(),
	tick: ingest_tick,
});

/* ─── Run-start + delete/deny acks + dashboard ───────────────────── */

/**
 * `POST /runs` value (2.3c): the orchestrator returns the run row's id +
 * creation status plus the resolved plan and the DO's advance echo — the
 * plan/advance fields are internal echo, deliberately STRIPPED by this
 * schema (ApiClient callers read `run_id`/`status` only). `status` is
 * the creation-time status ("queued" in practice, but the union is the
 * contract, not the literal).
 */
export const pipeline_run_start_wire = z.object({
	run_id: z.string().min(1),
	status: run_status,
});

/** `DELETE /packages/:id` / analysis-templates / oidc-trust acks. */
export const pipelines_deleted_wire = z.object({ deleted: z.literal(true) });

/** `POST /grants/:id/deny` ack. */
export const pipelines_deny_wire = z.object({ success: z.literal(true) });

/** Mirrors `pipeline_analysis_template` (`@devpad/schema/types`) field-for-field. */
export const pipeline_analysis_template_wire = z
	.object({
		...wire_entity,
		owner_id: z.string().min(1),
		name: z.string(),
		/** Free-form JSON stored but not consumed by any reader yet (2.1). */
		query_dsl: z.unknown(),
		threshold_dsl: z.string(),
		window_ms: z.number().int().positive(),
	})
	// zod infers an `unknown` field as optional; the row type requires it.
	.transform((template) => ({ ...template, query_dsl: template.query_dsl }));

/** Mirrors `pipeline_oidc_trust` (`@devpad/schema/types`) field-for-field. */
export const pipeline_oidc_trust_wire = z.object({
	...wire_entity,
	owner_id: z.string().min(1),
	provider: z.literal("github"),
	github_owner: z.string(),
	repo_pattern: z.string(),
	allowed_refs: z.array(z.string()),
	allowed_environments: z.array(z.string()),
	expected_audience: z.string(),
	allowed_actions: z.array(z.string()),
	session_ttl_seconds: z.number().int().positive(),
	last_used_at: z.string().nullable(),
	repository_id: z.string().nullable(),
	repository_owner_id: z.string().nullable(),
});

/**
 * Main-worker dashboard value (`GET /v1/pipelines/dashboard`, 2.3c):
 * `DashboardResponse` (the D1 aggregator snapshot, schema in
 * `@devpad/schema/validation`) plus the best-effort pulse `/summary`
 * enrichment — an object or null when pulse is unreachable/unconfigured.
 * Pulse is best-effort by design (the route never 503s on it), so a
 * malformed pulse body degrades to `null` instead of failing the read.
 */
export const pipelines_dashboard_wire = z.object({
	...dashboard_response.shape,
	pulse: z.record(z.unknown()).nullable().catch(null),
});

export const pipeline_analysis_template_list_wire = z.array(pipeline_analysis_template_wire);
export const pipeline_oidc_trust_list_wire = z.array(pipeline_oidc_trust_wire);

/* ─── Types ──────────────────────────────────────────────────────── */

export type PipelineRunWire = z.infer<typeof pipeline_run_wire>;
export type PipelineStageEventWire = z.infer<typeof pipeline_stage_event_wire>;
export type PipelineGrantWire = z.infer<typeof pipeline_grant_wire>;
export type PipelinePackageWire = z.infer<typeof pipeline_package_wire>;
export type PipelineDispatchEntryWire = z.infer<typeof pipeline_dispatch_entry_wire>;
export type PipelineDispatches = z.infer<typeof pipeline_dispatch_ledger_wire>;
export type PipelineIngestTick = z.infer<typeof ingest_tick>;
export type PipelineIngestResponseWire = z.infer<typeof pipeline_ingest_response_wire>;
export type PipelineRunStartWire = z.infer<typeof pipeline_run_start_wire>;
export type PipelinesDashboardWire = z.infer<typeof pipelines_dashboard_wire>;

/* ─── Schema-typed serialisers (orchestrator side) ───────────────── */

/**
 * Require the drizzle row to carry NO keys outside the wire schema —
 * combined with the serialiser's declared return type (which catches
 * missing and mistyped fields), a row/wire divergence is a compile error.
 */
type RowMatches<Row, Wire> = Row & { [K in Exclude<keyof Row, keyof Wire>]: never };

export const wire_run = (row: RowMatches<PipelineRun, PipelineRunWire>): PipelineRunWire => ({ ...row });

export const wire_stage_event = (
	row: RowMatches<PipelineStageEvent, PipelineStageEventWire>,
): PipelineStageEventWire => ({
	...row,
});

export const wire_grant = (row: RowMatches<PipelineGrant, PipelineGrantWire>): PipelineGrantWire => ({ ...row });

export const wire_package = (row: RowMatches<PipelinePackage, PipelinePackageWire>): PipelinePackageWire => ({
	...row,
});

/**
 * The dispatch ledger PROJECTS the `pipeline_dispatch` row (drops
 * `run_id` — it's the envelope's `run_id`), so this one is an explicit
 * field map: a dropped/renamed row column is a compile error here.
 */
export const wire_dispatch_entry = (row: PipelineDispatch): PipelineDispatchEntryWire => ({
	stage_name: row.stage_name,
	commit_sha: row.commit_sha,
	status: row.status,
	error: row.error,
	requested_by: row.requested_by,
	created_at: row.created_at,
	updated_at: row.updated_at,
});
