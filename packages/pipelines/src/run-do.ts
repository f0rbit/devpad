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
 * - `alarm()` fires `tick_bake_complete` (bake purpose) or, when the
 *   alarm was armed as an external deploy timeout, parks the run in
 *   `unconfirmed`. No business logic here.
 *
 * If you find yourself writing transition logic in this file, stop —
 * push it down into `runs.ts` / `state-machine.ts`.
 */

import {
	advance_run,
	apply_external_event,
	approve_stage,
	cancel_run,
	get_run,
	is_terminal_status,
	redispatch,
	request_rollback,
	tick_bake_complete,
	tick_deploy_timeout,
} from "@devpad/core/services/pipelines";
import type {
	AdvanceError,
	ExternalEventInput,
	ResolvedPlan,
	RunDeps,
	RunEvent,
	TransitionOutput,
} from "@devpad/core/services/pipelines";
import type { Result } from "@f0rbit/corpus";
import { z } from "zod";

const plan_body = z.object({ plan: z.unknown(), actor: z.string().optional() });

/**
 * Approve body arriving from the route layer. `actor` is the
 * `X-Devpad-Actor` value — the route has already verified admin identity
 * + human channel before this DO fetch happens; the DO itself is not a
 * trust boundary for it, so it's recorded verbatim.
 */
const approve_body = z.object({
	stage_name: z.string(),
	decision: z.enum(["approved", "denied"]),
	actor: z.string(),
	reason: z.string().optional(),
	plan: z.unknown(),
});

const STORAGE_KEYS = {
	plan: "plan",
	last_alarm_ms: "last_alarm_ms",
	last_event_id: "last_event_id",
	alarm_purpose: "alarm_purpose",
} as const;

/** What the currently-armed alarm is for — bake windows vs external deploy timeouts. */
export type AlarmPurpose = "bake" | "external_timeout";

/**
 * Structural shape for the DurableObjectState slice the orchestrator
 * actually touches. Matches both `@cloudflare/workers-types`'s
 * `DurableObjectState` and the in-memory fake.
 */
export type DoCtx = {
	id: { toString(): string };
	storage: {
		get<T = unknown>(key: string): Promise<T | undefined>;
		put(key: string, value: unknown): Promise<void>;
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

// `init.headers` is `ResponseInit["headers"]` — may be a `Headers` instance
// (not a plain object), so spreading it directly can silently drop entries.
const response_header_entries = (h: ResponseInit["headers"]): Array<[string, string]> => {
	if (h === undefined) return [];
	if (h instanceof Headers) return [...h.entries()];
	if (Array.isArray(h)) return h;
	return Object.entries(h);
};

const json = (value: unknown, init?: ResponseInit): Response => {
	const headers = new Headers({ "content-type": "application/json" });
	for (const [key, value_] of response_header_entries(init?.headers)) headers.set(key, value_);
	return new Response(JSON.stringify(value), { ...init, headers });
};

const json_ok = (value: unknown): Response => json({ ok: true, value });

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

const json_err = (status: number, error: unknown): Response =>
	json({ ok: false, error: to_wire_error(error) }, { status });

const STATUS_BY_CODE: Record<string, number> = {
	not_found: 404,
	no_previous_version: 409,
	terminal_state: 409,
	invalid_event: 409,
	conflict: 409,
	validation_error: 400,
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

	const schedule_alarm_if_needed = async (output: TransitionOutput, plan: ResolvedPlan): Promise<void> => {
		// External deploy mode (#155): every time a commit-target run
		// enters `deploying`, re-arm the deploy-timeout alarm. Both the
		// staging no-op (waiting for CI) and the production dispatch
		// (waiting for CI) pass through here.
		if (output.kind === "needs_deploy" && plan.target.kind === "commit" && plan.external_timeout_ms !== null) {
			const fire_at = now() + plan.external_timeout_ms;
			await ctx.storage.setAlarm(fire_at);
			await ctx.storage.put(STORAGE_KEYS.last_alarm_ms, fire_at);
			await ctx.storage.put(STORAGE_KEYS.alarm_purpose, "external_timeout" satisfies AlarmPurpose);
			return;
		}
		if (output.kind !== "needs_bake_schedule") return;
		const fire_at = now() + output.duration_ms;
		await ctx.storage.setAlarm(fire_at);
		await ctx.storage.put(STORAGE_KEYS.last_alarm_ms, fire_at);
		await ctx.storage.put(STORAGE_KEYS.alarm_purpose, "bake" satisfies AlarmPurpose);
	};

	const advance = async (plan: ResolvedPlan, event: RunEvent): Promise<Result<TransitionOutput, AdvanceError>> => {
		const result = await advance_run(services.deps, run_id, event, plan);
		if (result.ok) await schedule_alarm_if_needed(result.value, plan);
		return result;
	};

	const handle_advance = async (body: unknown): Promise<Response> => {
		const parsed = plan_body.safeParse(body);
		if (!parsed.success) return json_err(400, { code: "invalid_body", issues: parsed.error.issues });
		const plan = await load_plan_or_body(parsed.data.plan);
		if (plan === null) return json_err(400, { code: "missing_plan" });
		const result = await advance(plan, { kind: "start", actor: parsed.data.actor });
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
				decision: parsed.data.decision,
				user_id: parsed.data.actor,
				reason: parsed.data.reason,
			},
			plan,
		);
		if (result.ok) await schedule_alarm_if_needed(result.value, plan);
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

	/**
	 * `POST /external-event` — externally-ingested CI stage events
	 * (#155). The stage event service forwards every
	 * transition-relevant webhook here with the stage name + payload;
	 * the runs service decides acceptance (external + current stage +
	 * SHA match). Orchestration never enters this file.
	 */
	const handle_external_event = async (body: unknown): Promise<Response> => {
		const parsed = z
			.object({
				kind: z.literal("external_event"),
				event_kind: z.enum(["deploy_completed", "deploy_failed"]),
				stage_name: z.string().min(1),
				payload: z.unknown().optional(),
			})
			.safeParse(body);
		if (!parsed.success) return json_err(400, { code: "invalid_body", issues: parsed.error.issues });
		const input: ExternalEventInput = {
			event_kind: parsed.data.event_kind,
			stage_name: parsed.data.stage_name,
			payload: parsed.data.payload,
		};
		const result = await apply_external_event(services.deps, run_id, input);
		return result_to_response(result);
	};

	/**
	 * `POST /redispatch` — human-only (enforced upstream by
	 * `require_human_actor`); flips a FAILED dispatch row back to claimed
	 * via a guarded UPDATE and dispatches exactly once.
	 */
	const handle_redispatch = async (body: unknown): Promise<Response> => {
		const parsed = z.object({ actor: z.string().min(1) }).safeParse(body);
		if (!parsed.success) return json_err(400, { code: "invalid_body", issues: parsed.error.issues });
		const result = await redispatch(services.deps, run_id, parsed.data.actor);
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

		let body: unknown = null;
		try {
			const parsed_body: unknown = await request.json();
			body = parsed_body;
		} catch {
			body = null;
		}
		if (body === null) return json_err(400, { code: "invalid_json" });

		if (action === "advance") return handle_advance(body);
		if (action === "approve") return handle_approve(body);
		if (action === "cancel") return handle_cancel(body);
		if (action === "rollback") return handle_rollback(body);
		if (action === "external-event") return handle_external_event(body);
		if (action === "redispatch") return handle_redispatch(body);

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
			await ctx.storage.delete(STORAGE_KEYS.alarm_purpose);
			return;
		}
		const plan = await ctx.storage.get<ResolvedPlan>(STORAGE_KEYS.plan);
		if (plan === undefined) return;
		await ctx.storage.delete(STORAGE_KEYS.last_alarm_ms);
		const purpose = (await ctx.storage.get<AlarmPurpose>(STORAGE_KEYS.alarm_purpose)) ?? "bake";

		if (purpose === "external_timeout") {
			// #155: the timeout only parks the run while it is actually
			// waiting on CI in `deploying`. A gate wait (manual approval)
			// or any other state is not a lost dispatch — drop the alarm
			// without touching the state machine.
			await ctx.storage.delete(STORAGE_KEYS.alarm_purpose);
			await ctx.storage.deleteAlarm();
			if (!run.ok || run.value.status !== "deploying") return;
			const timed_out = await tick_deploy_timeout(services.deps, run_id, plan);
			if (timed_out.ok) await schedule_alarm_if_needed(timed_out.value, plan);
			return;
		}

		const result = await tick_bake_complete(services.deps, run_id, plan);
		if (result.ok) await schedule_alarm_if_needed(result.value, plan);
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
