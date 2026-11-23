/**
 * Shared reader for the `pipeline_run.resolved_*` snapshot columns on the
 * run-detail page (StageGate + RunProgress).
 *
 * These arrive as already-parsed OBJECTS on the wire (drizzle `mode: "json"`
 * on the orchestrator; the main-worker proxy forwards them unchanged). The
 * previous UI `JSON.parse`d them — the throw was swallowed by a silent
 * catch, so Approve/Deny never rendered for any `awaiting_approval` run.
 *
 * All readers accept the object form, and defensively a JSON string (older
 * wire shapes), and return a typed Result — a parse failure is surfaced to
 * the caller for explicit rendering, never swallowed.
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
export type StageProgress = { stages: string[]; current_index: number };

export const GATE_READ_ERROR = "Couldn't read this run's gate configuration.";
export const ROLLOUT_READ_ERROR = "Couldn't read this run's rollout configuration.";

const summarize = (error: z.ZodError): string => {
	const first = error.issues.at(0);
	if (!first) return "unexpected schema rejection";
	const path = first.path.length > 0 ? `${first.path.join(".")}: ` : "";
	return `${path}${first.message}`;
};

const json_from_string = (raw: string): PlanResult<unknown> => {
	try {
		return { ok: true, value: JSON.parse(raw) as unknown };
	} catch (error) {
		return { ok: false, reason: error instanceof Error ? error.message : "not valid JSON" };
	}
};

const flex_read = <T>(schema: z.ZodType<T>, raw: unknown): PlanResult<T> => {
	const direct = schema.safeParse(raw);
	if (direct.success) return { ok: true, value: direct.data };
	if (typeof raw !== "string") return { ok: false, reason: summarize(direct.error) };
	const json = json_from_string(raw);
	if (!json.ok) return { ok: false, reason: json.reason };
	const revalidated = schema.safeParse(json.value);
	if (revalidated.success) return { ok: true, value: revalidated.data };
	return { ok: false, reason: summarize(revalidated.error) };
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
 * Stage list for RunProgress. External deploy runs (#155) snapshot only the
 * post-staging stages into `resolved_rollout` (`staging` is filtered out —
 * CI owns that deploy), so an external run's `current_stage` ("staging")
 * is missing from the rollout; render the real external flow
 * `staging → production` instead.
 */
export const stages_for_run = (
	run: { current_stage: string | null; commit_sha: string | null },
	rollout: Rollout,
): StageProgress => {
	const rollout_stages = rollout.type === "gradual" ? rollout.stages.map((s) => s.name) : [];
	const current = run.current_stage;
	if (current !== null && rollout_stages.includes(current)) {
		return { stages: rollout_stages, current_index: rollout_stages.indexOf(current) };
	}
	if (run.commit_sha !== null && current !== null) {
		const external_stages = rollout_stages.length > 0 ? ["staging", ...rollout_stages] : ["staging", "production"];
		return { stages: external_stages, current_index: external_stages.indexOf(current) };
	}
	return { stages: rollout_stages, current_index: current === null ? -1 : rollout_stages.indexOf(current) };
};
