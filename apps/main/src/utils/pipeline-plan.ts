/**
 * Shared reader for the `pipeline_run.resolved_*` snapshot columns on the
 * run-detail page (StageGate + RunProgress).
 *
 * These arrive as already-parsed OBJECTS on the wire (drizzle `mode: "json"`
 * on the orchestrator, Zod-validated at the core read boundary
 * (`services/pipelines/row-parse.ts`); the main-worker proxy forwards them
 * unchanged). The previous UI `JSON.parse`d them — the throw was swallowed
 * by a silent catch, so Approve/Deny never rendered for any
 * `awaiting_approval` run. The defensive JSON-string fallback that followed
 * is gone: the columns are typed end-to-end now, and a malformed row is a
 * `store_error` at the core read, never a string on the wire.
 *
 * All readers Zod-validate the object form and return a typed Result — a
 * parse failure is surfaced to the caller for explicit rendering, never
 * swallowed.
 */
import { resolved_rollout } from "@devpad/schema";
import { z } from "zod";

export type PlanResult<T> = { ok: true; value: T } | { ok: false; reason: string };

/**
 * Display-shaped gate entry. Looser than the schema's `gate_descriptor`
 * discriminated union: it tolerates a `verdict` field some historical wire
 * shapes carried, and passes through unknown extras instead of failing a
 * render over cosmetic drift.
 */
const gate_entry = z.object({
	type: z.enum(["manual", "auto", "analysis"]),
	verdict: z.string().nullish(),
	afterBake: z.boolean().optional(),
	template: z.string().optional(),
});

export type GateEntry = z.infer<typeof gate_entry>;
export type GateTransition = { key: string; gate: GateEntry };
export type Rollout = z.infer<typeof resolved_rollout>;
export type StageProgress = {
	stages: string[];
	current_index: number;
	/** Leading stages already finished. Defaults to `current_index` (everything before the current stage is done). */
	done_count?: number;
};

export const GATE_READ_ERROR = "Couldn't read this run's gate configuration.";
export const ROLLOUT_READ_ERROR = "Couldn't read this run's rollout configuration.";

/** A resolved manual-gate decision, read back from `gate_verdict` stage events. */
export type GateDecision = {
	verdict: "Pass" | "Fail";
	decided_by?: string;
	decided_at?: string;
	reason?: string;
};

/**
 * `gate_verdict` event payloads written by `approve_stage`. Older events
 * lack `decided_by`/`decided_at` — both optional. Payloads that don't
 * carry a resolved verdict (e.g. a Pending placeholder) don't parse and
 * are skipped by {@link decision_for_transition}.
 */
const gate_verdict_payload = z.object({
	verdict: z.enum(["Pass", "Fail"]),
	decided_by: z.string().optional(),
	decided_at: z.string().optional(),
	reason: z.string().optional(),
});

const gate_verdict_event = z.object({
	stage_name: z.string(),
	ts: z.string(),
	payload: gate_verdict_payload,
});

const summarize = (error: z.ZodError): string => {
	const first = error.issues.at(0);
	if (!first) return "unexpected schema rejection";
	const path = first.path.length > 0 ? `${first.path.join(".")}: ` : "";
	return `${path}${first.message}`;
};

const flex_read = <T>(schema: z.ZodType<T>, raw: unknown): PlanResult<T> => {
	const parsed = schema.safeParse(raw);
	if (parsed.success) return { ok: true, value: parsed.data };
	return { ok: false, reason: summarize(parsed.error) };
};

export const read_gates = (raw: unknown): PlanResult<Record<string, GateEntry>> =>
	flex_read(z.record(z.string(), gate_entry), raw);

export const read_rollout = (raw: unknown): PlanResult<Rollout> => flex_read(resolved_rollout, raw);

/**
 * The gate governing `current_stage`'s transition. Transition keys are
 * `{from}→{to}`; the gate for a stage is the transition OUT of it (live shape:
 * `current_stage: "staging"` + key `staging→production`), so an exact source
 * match wins, falling back to the historical substring behaviour (first key
 * containing the stage).
 */
export const gate_for_stage = (gates: Record<string, GateEntry>, current_stage: string): GateTransition | null => {
	const by_source = Object.entries(gates).find(([key]) => key.startsWith(`${current_stage}→`));
	const loose = by_source ?? Object.entries(gates).find(([key]) => key.includes(current_stage));
	if (!loose) return null;
	return { key: loose[0], gate: loose[1] };
};

/** `{from}→{to}` transition key → the `to` stage, or null for malformed keys. */
export const target_stage_of = (gate_key: string): string | null => {
	const parts = gate_key.split("→");
	return parts[1] ?? null;
};

/**
 * The latest human decision recorded for the gate governing `to_stage`,
 * read from the run's `gate_verdict` stage events (the payload written by
 * the orchestrator's `approve_stage`). Events are Zod-parsed — anything
 * that doesn't match (old shapes, foreign payloads) is skipped, and a
 * missing decision renders the plain approval prompt. When several
 * verdicts exist, the newest `ts` wins.
 */
export const decision_for_transition = (events: unknown, to_stage: string): GateDecision | null => {
	if (!Array.isArray(events)) return null;
	const rows: unknown[] = events;
	const candidates = rows.flatMap((event) => {
		const parsed = gate_verdict_event.safeParse(event);
		if (!parsed.success || parsed.data.stage_name !== to_stage) return [];
		return [parsed.data];
	});
	const latest = candidates.reduce<(typeof candidates)[number] | null>(
		(acc, c) => (acc === null || c.ts >= acc.ts ? c : acc),
		null,
	);
	return latest?.payload ?? null;
};

/** External deploy runs (#155): CI owns staging, so the rollout snapshot may lack it. */
const external_stage_list = (rollout_stages: string[]): string[] => {
	if (rollout_stages.length === 0) return ["staging", "production"];
	if (rollout_stages.includes("staging")) return rollout_stages;
	return ["staging", ...rollout_stages];
};

/**
 * Stage list for RunProgress. External DEPLOY runs (#155) snapshot only the
 * post-staging stages into `resolved_rollout` (`staging` is filtered out —
 * CI owns that deploy), so `staging` is ALWAYS rendered first for them —
 * not only while `current_stage` is missing from the rollout — and a
 * terminal-successful run marks every stage done. External rollback runs
 * keep `[production]` only. Orchestrated runs are unchanged.
 */
export const stages_for_run = (
	run: { current_stage: string | null; commit_sha: string | null; kind: string; status: string },
	rollout: Rollout,
): StageProgress => {
	const rollout_stages = rollout.type === "gradual" ? rollout.stages.map((s) => s.name) : [];
	const current = run.current_stage;

	if (run.commit_sha !== null && run.kind !== "rollback") {
		const stages = external_stage_list(rollout_stages);
		const idx = current !== null ? stages.indexOf(current) : -1;
		if (run.status === "completed") return { stages, current_index: -1, done_count: stages.length };
		return { stages, current_index: idx };
	}
	if (run.commit_sha !== null) {
		// External rollback: atomic shape, production only.
		const stages = rollout_stages.length > 0 ? rollout_stages : ["production"];
		const idx = current !== null ? stages.indexOf(current) : -1;
		return { stages, current_index: idx };
	}
	if (current !== null && rollout_stages.includes(current)) {
		return { stages: rollout_stages, current_index: rollout_stages.indexOf(current) };
	}
	return { stages: rollout_stages, current_index: current === null ? -1 : rollout_stages.indexOf(current) };
};
