/**
 * @module pipeline-templates/dsl
 *
 * `extendTemplate(overrides)` — the DSL packages use to declare their
 * pipeline in `pipeline.ts`. Pure, deterministic merge over the two
 * default templates ({@link defaultGradual} / {@link defaultAtomic}):
 *
 * - Stage overrides match by `name`. Absent fields keep their default
 *   (e.g. overriding only `traffic` preserves the default `bake`).
 * - Gate overrides match by transition key. Absent transitions keep
 *   their default gate.
 * - The base template is selected by `overrides.rollout.type`:
 *   - `"atomic"` → start from `defaultAtomic` / `defaultAtomicGates`
 *   - `"gradual"` (explicit) or omitted → start from `defaultGradual`
 *     / `defaultGradualGates`
 * - Unknown stage names and unknown transition keys are errors —
 *   returning a typed `Result.err`, never throwing — so a typo in a
 *   `pipeline.ts` is caught at template-build time, not silently
 *   no-op'd.
 *
 * Forced-atomic resolution (see {@link resolve_rollout}) runs *after*
 * this DSL — the manifest is not visible here.
 */

import { err, ok, type Result } from "@f0rbit/corpus";
import { defaultAtomic, defaultAtomicGates } from "./default-atomic";
import { defaultGradual, defaultGradualGates } from "./default-gradual";
import { parse_duration } from "./rollout";
import type { Duration, Gate, PipelineTemplate, Rollout, TransitionKey } from "./types";

export type DslError =
	| { code: "unknown_stage"; message: string; stage: string }
	| { code: "unknown_transition"; message: string; transition: string }
	| { code: "duration_parse"; message: string; input: string };

/** Shorthand the DSL accepts for a bake window — either a parsed `{ ms }` or the `"30m"` string. */
type DurationInput = Duration | string;

type StageOverride = {
	name: string;
	traffic?: number;
	bake?: DurationInput;
};

type GradualRolloutOverride = {
	type?: "gradual";
	stages?: StageOverride[];
};

type AtomicRolloutOverride = {
	type: "atomic";
};

type RolloutOverride = GradualRolloutOverride | AtomicRolloutOverride;

export type ExtendTemplateOverrides = {
	rollout?: RolloutOverride;
	gates?: Partial<Record<TransitionKey, Gate>>;
};

const is_atomic_override = (r: RolloutOverride | undefined): r is AtomicRolloutOverride =>
	r !== undefined && r.type === "atomic";

const normalise_duration = (input: DurationInput): Result<Duration, DslError> => {
	if (typeof input === "string") return parse_duration(input);
	return ok(input);
};

const merge_gradual_stages = (
	base: Rollout & { type: "gradual" },
	overrides: StageOverride[] | undefined,
): Result<Rollout, DslError> => {
	if (overrides === undefined || overrides.length === 0) {
		return ok({ type: "gradual", stages: base.stages.map((s) => ({ ...s, bake: { ...s.bake } })) });
	}
	const by_name = new Map(base.stages.map((s) => [s.name, s] as const));
	for (const override of overrides) {
		if (!by_name.has(override.name)) {
			return err({
				code: "unknown_stage",
				message: `unknown stage in override: ${override.name}`,
				stage: override.name,
			});
		}
	}
	const stages: Array<{ name: string; traffic: number; bake: Duration }> = [];
	for (const stage of base.stages) {
		const override = overrides.find((o) => o.name === stage.name);
		if (override === undefined) {
			stages.push({ ...stage, bake: { ...stage.bake } });
			continue;
		}
		const bake_result = override.bake !== undefined ? normalise_duration(override.bake) : ok({ ...stage.bake });
		if (!bake_result.ok) return bake_result;
		stages.push({
			name: stage.name,
			traffic: override.traffic ?? stage.traffic,
			bake: bake_result.value,
		});
	}
	return ok({ type: "gradual", stages });
};

const merge_gates = (
	base: Record<TransitionKey, Gate>,
	overrides: Partial<Record<TransitionKey, Gate>> | undefined,
): Result<Record<TransitionKey, Gate>, DslError> => {
	const merged: Record<TransitionKey, Gate> = { ...base };
	if (overrides === undefined) return ok(merged);
	for (const key of Object.keys(overrides) as TransitionKey[]) {
		if (!(key in base)) {
			return err({
				code: "unknown_transition",
				message: `unknown transition in override: ${key}`,
				transition: key,
			});
		}
		const gate = overrides[key];
		if (gate !== undefined) merged[key] = gate;
	}
	return ok(merged);
};

/**
 * Build a {@link PipelineTemplate} by merging `overrides` over the chosen
 * default template. Returns a {@link Result} so unknown stages /
 * transitions surface as typed errors at template-build time instead of
 * silently mis-deploying.
 *
 * The returned template is a deep clone of the defaults — mutating the
 * result will not affect the exported defaults, and vice versa.
 */
export const extendTemplate = (overrides: ExtendTemplateOverrides = {}): Result<PipelineTemplate, DslError> => {
	const is_atomic = is_atomic_override(overrides.rollout);
	const base_rollout: Rollout = is_atomic ? defaultAtomic : defaultGradual;
	const base_gates = is_atomic ? defaultAtomicGates : defaultGradualGates;

	if (is_atomic) {
		const gates_result = merge_gates(base_gates, overrides.gates);
		if (!gates_result.ok) return gates_result;
		return ok({
			rollout: { type: "atomic" },
			gates: gates_result.value,
		});
	}

	if (base_rollout.type !== "gradual") {
		// Unreachable: base_rollout when !is_atomic is defaultGradual.
		return err({
			code: "unknown_stage",
			message: "unreachable: gradual base expected",
			stage: "(unknown)",
		});
	}

	const gradual_override = overrides.rollout && overrides.rollout.type !== "atomic" ? overrides.rollout : undefined;
	const rollout_result = merge_gradual_stages(base_rollout, gradual_override?.stages);
	if (!rollout_result.ok) return rollout_result;

	const gates_result = merge_gates(base_gates, overrides.gates);
	if (!gates_result.ok) return gates_result;

	return ok({
		rollout: rollout_result.value,
		gates: gates_result.value,
	});
};
