/**
 * @module pipelines/run-do
 *
 * `PipelineRunDO` — Durable Object run host. Thin wrapper around the
 * `@devpad/core` runs service. The DO is purely a scheduling /
 * dispatch shell:
 *
 * - The run id is `ctx.id.toString()` — every DO instance is keyed by
 *   `idFromName(run_id)` from the parent Worker.
 * - State of the run lives in D1 (`pipeline_run`, `pipeline_stage_event`,
 *   `pipeline_approval`). The DO **rehydrates** from D1 on every call
 *   via the `runs.ts` service.
 * - The DO's `ctx.storage` only holds in-flight scheduling state:
 *   `plan` (resolved plan snapshot — small, immutable for the run),
 *   `last_alarm_ms` (for observability/dedup), `last_event_id` (for
 *   idempotency, reserved for Phase 2 webhook handling).
 * - `fetch()` is a small internal RPC: `/advance`, `/approve`,
 *   `/cancel`, `/rollback`, `/state` (debug).
 * - `alarm()` fires `tick_bake_complete`. No business logic here.
 *
 * If you find yourself writing transition logic in this file, stop —
 * push it down into `runs.ts` / `state-machine.ts`.
 */

import type { AdvanceError, ResolvedPlan, RunDeps, RunEvent, TransitionOutput } from "@devpad/core/services/pipelines";
import { advance_run, approve_stage, cancel_run, get_run, is_terminal_status, request_rollback, tick_bake_complete } from "@devpad/core/services/pipelines";
import type { ApprovalDecision } from "@devpad/schema";
import type { Result } from "@f0rbit/corpus";
import { z } from "zod";

const plan_body = z.object({ plan: z.unknown() });

const approve_body = z.object({
	stage_name: z.string(),
	decision: z.enum(["approved", "denied"]),
	user_id: z.string(),
	reason: z.string().optional(),
	plan: z.unknown(),
});

const STORAGE_KEYS = {
	plan: "plan",
	last_alarm_ms: "last_alarm_ms",
	last_event_id: "last_event_id",
} as const;

/**
 * Structural shape for the DurableObjectState slice the orchestrator
 * actually touches. Matches both `@cloudflare/workers-types`'s
 * `DurableObjectState` and the in-memory fake.
 */
export type DoCtx = {
	id: { toString(): string };
	storage: {
		get<T = unknown>(key: string): Promise<T | undefined>;
		put<T = unknown>(key: string, value: T): Promise<void>;
		delete(key: string): Promise<boolean>;
		getAlarm(): Promise<number | null>;
		setAlarm(ms: number): Promise<void>;
		deleteAlarm(): Promise<void>;
	};
};

export type RunDoServices = {
	deps: RunDeps;
	/** Test seam — defaults to `Date.now`. Lets unit tests pin time. */
	now?: () => number;
};

const json = <T>(value: T, init?: ResponseInit): Response => new Response(JSON.stringify(value), { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });

const json_ok = <T>(value: T): Response => json({ ok: true, value });

/**
 * Wire-shaped error envelope. Normalises service-layer `kind` to the
 * public `code` discriminator and flattens any accidental Result
 * wrapping so the response is never double-wrapped. Mirror of
 * `routes.ts`'s `to_wire_error` — kept local to avoid a cross-module
 * helper that pulls Hono into the DO bundle.
 */
type WireError = { code: string; message?: string } & Record<string, unknown>;

const to_wire_error = (input: unknown): WireError => {
	if (input === null || typeof input !== "object") return { code: "unknown", message: String(input) };
	const rec = input as Record<string, unknown>;
	if (rec.ok === false && "error" in rec) return to_wire_error(rec.error);
	const code = typeof rec.code === "string" ? rec.code : typeof rec.kind === "string" ? rec.kind : "unknown";
	const { kind: _kind, code: _code, ok: _ok, ...rest } = rec;
	return { code, ...rest };
};

const json_err = (status: number, error: unknown): Response => json({ ok: false, error: to_wire_error(error) }, { status });

const STATUS_BY_CODE: Record<string, number> = {
	not_found: 404,
	no_previous_version: 409,
	terminal_state: 409,
	invalid_event: 409,
	missing_gate: 500,
};

const error_to_status = (error: AdvanceError): number => {
	const code = "code" in error ? error.code : "kind" in error ? error.kind : "";
	return STATUS_BY_CODE[code] ?? 500;
};

const result_to_response = <T>(result: Result<T, AdvanceError>): Response => {
	if (result.ok) return json_ok(result.value);
	return json_err(error_to_status(result.error), result.error);
};

/**
 * Pure handler factory. The actual DO class delegates to one of these
 * — keeping the logic on a plain function means the in-memory test
 * harness can call the same code without constructing a real
 * Cloudflare DO.
 */
export const make_run_handler = (ctx: DoCtx, services: RunDoServices) => {
	const now = services.now ?? Date.now;
	// Prefer `id.name` so the run_id matches the D1 row id used by the
	// orchestrator route (`idFromName(row_id)`). Falls back to the hex
	// id for in-memory tests that construct DoCtx directly.
	const ctx_id = ctx.id as { name?: string; toString: () => string };
	const run_id = ctx_id.name ?? ctx_id.toString();

	const persist_plan = async (plan: ResolvedPlan): Promise<void> => {
		await ctx.storage.put(STORAGE_KEYS.plan, plan);
	};

	const load_plan_or_body = async (body_plan: unknown): Promise<ResolvedPlan | null> => {
		if (body_plan !== undefined && body_plan !== null) {
			const plan = body_plan as ResolvedPlan;
			await persist_plan(plan);
			return plan;
		}
		const stored = await ctx.storage.get<ResolvedPlan>(STORAGE_KEYS.plan);
		return stored ?? null;
	};

	const schedule_alarm_if_needed = async (output: TransitionOutput): Promise<void> => {
		if (output.kind !== "needs_bake_schedule") return;
		const fire_at = now() + output.duration_ms;
		await ctx.storage.setAlarm(fire_at);
		await ctx.storage.put(STORAGE_KEYS.last_alarm_ms, fire_at);
	};

	const advance = async (plan: ResolvedPlan, event: RunEvent): Promise<Result<TransitionOutput, AdvanceError>> => {
		const result = await advance_run(services.deps, run_id, event, plan);
		if (result.ok) await schedule_alarm_if_needed(result.value);
		return result;
	};

	const handle_advance = async (body: unknown): Promise<Response> => {
		const parsed = plan_body.safeParse(body);
		if (!parsed.success) return json_err(400, { code: "invalid_body", issues: parsed.error.issues });
		const plan = await load_plan_or_body(parsed.data.plan);
		if (plan === null) return json_err(400, { code: "missing_plan" });
		const result = await advance(plan, { kind: "start" });
		return result_to_response(result);
	};

	const handle_approve = async (body: unknown): Promise<Response> => {
		const parsed = approve_body.safeParse(body);
		if (!parsed.success) return json_err(400, { code: "invalid_body", issues: parsed.error.issues });
		const plan = await load_plan_or_body(parsed.data.plan);
		if (plan === null) return json_err(400, { code: "missing_plan" });
		const result = await approve_stage(
			services.deps,
			{
				run_id,
				stage_name: parsed.data.stage_name,
				decision: parsed.data.decision as ApprovalDecision,
				user_id: parsed.data.user_id,
				reason: parsed.data.reason,
			},
			plan
		);
		if (result.ok) await schedule_alarm_if_needed(result.value);
		return result_to_response(result);
	};

	const handle_cancel = async (body: unknown): Promise<Response> => {
		const parsed = plan_body.safeParse(body);
		if (!parsed.success) return json_err(400, { code: "invalid_body", issues: parsed.error.issues });
		const plan = await load_plan_or_body(parsed.data.plan);
		if (plan === null) return json_err(400, { code: "missing_plan" });
		const result = await cancel_run(services.deps.db, run_id, plan);
		await ctx.storage.deleteAlarm();
		if (!result.ok) return json_err(error_to_status(result.error), result.error);
		return json_ok({ kind: "done" });
	};

	const handle_rollback = async (body: unknown): Promise<Response> => {
		const parsed = plan_body.safeParse(body);
		if (!parsed.success) return json_err(400, { code: "invalid_body", issues: parsed.error.issues });
		const plan = await load_plan_or_body(parsed.data.plan);
		if (plan === null) return json_err(400, { code: "missing_plan" });
		const result = await request_rollback(services.deps, run_id, plan);
		await ctx.storage.deleteAlarm();
		return result_to_response(result);
	};

	const handle_state = async (): Promise<Response> => {
		const plan = (await ctx.storage.get<ResolvedPlan>(STORAGE_KEYS.plan)) ?? null;
		const last_alarm_ms = (await ctx.storage.get<number>(STORAGE_KEYS.last_alarm_ms)) ?? null;
		return json_ok({ run_id, plan, last_alarm_ms });
	};

	const handle = async (request: Request): Promise<Response> => {
		const url = new URL(request.url);
		const segments = url.pathname.split("/").filter(Boolean);
		const action = segments[segments.length - 1] ?? "";

		if (request.method === "GET" && action === "state") return handle_state();

		if (request.method !== "POST") return json_err(405, { code: "method_not_allowed" });

		const body = await request.json().catch(() => null);
		if (body === null) return json_err(400, { code: "invalid_json" });

		if (action === "advance") return handle_advance(body);
		if (action === "approve") return handle_approve(body);
		if (action === "cancel") return handle_cancel(body);
		if (action === "rollback") return handle_rollback(body);

		return json_err(404, { code: "no_route", path: url.pathname });
	};

	const fire_alarm = async (): Promise<void> => {
		// Idempotency guard: if the run reached a terminal state between
		// `setAlarm` and the alarm firing (e.g. an out-of-band cancel or
		// rollback), drop the alarm cleanly without trying to advance the
		// state machine — `tick_bake_complete` would `terminal_state`-error
		// on the next transition and we'd emit a spurious pulse event.
		const run = await get_run(services.deps.db, run_id);
		if (run.ok && is_terminal_status(run.value.status)) {
			await ctx.storage.deleteAlarm();
			await ctx.storage.delete(STORAGE_KEYS.last_alarm_ms);
			return;
		}
		const plan = await ctx.storage.get<ResolvedPlan>(STORAGE_KEYS.plan);
		if (plan === undefined) return;
		await ctx.storage.delete(STORAGE_KEYS.last_alarm_ms);
		const result = await tick_bake_complete(services.deps, run_id, plan);
		if (result.ok) await schedule_alarm_if_needed(result.value);
	};

	return { handle, fire_alarm, persist_plan, advance };
};

/**
 * Production DO class shape. The actual constructor lives in
 * `index.ts` where the env → RunDeps wiring is decided. We export the
 * type alias here so wrangler.jsonc's
 * `durable_objects.bindings[].class_name` references something
 * structural.
 */
export type PipelineRunDOLike = {
	fetch(request: Request): Promise<Response>;
	alarm(): Promise<void>;
};
