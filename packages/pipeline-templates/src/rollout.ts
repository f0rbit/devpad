/**
 * @module pipeline-templates/rollout
 *
 * Pure helpers around {@link Rollout}: parsing the `"30m"` shorthand into
 * {@link Duration}, and expanding a `Rollout` into the ordered {@link Stage}
 * list the orchestrator iterates at runtime.
 *
 * `expand_rollout` is intentionally pure — atomic rollouts always produce the
 * same `staging → atomic-prod` pair, gradual rollouts mirror their declared
 * stages with an implicit `staging` prefix. The state machine in
 * `@devpad/core` consumes the returned `Stage[]` and walks transitions.
 */

import { err, ok, type Result } from "@f0rbit/corpus";
import type { Duration, Rollout, Stage } from "./types.ts";

export type DurationParseError = {
	code: "duration_parse";
	message: string;
	input: string;
};

const DURATION_RE = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/;

const UNIT_MS: Record<string, number> = {
	ms: 1,
	s: 1_000,
	m: 60_000,
	h: 3_600_000,
	d: 86_400_000,
};

/**
 * Parse the DSL's duration shorthand into a normalised {@link Duration}.
 *
 * Accepted shapes: `"0"` → 0ms, `"500ms"`, `"30s"`, `"30m"`, `"2h"`, `"1d"`.
 * A bare number is treated as milliseconds for forward-compat with raw
 * `{ ms }` literals. Returns `err` for any other input — the DSL surfaces
 * this as a stage-validation failure, never throws.
 */
export const parse_duration = (input: string): Result<Duration, DurationParseError> => {
	if (input === "0") return ok({ ms: 0 });
	const match = DURATION_RE.exec(input.trim());
	if (!match) {
		return err({ code: "duration_parse", message: `invalid duration: ${input}`, input });
	}
	const [, raw_value, raw_unit] = match;
	const value = Number(raw_value);
	const unit = raw_unit ?? "ms";
	return ok({ ms: Math.round(value * UNIT_MS[unit]) });
};

/**
 * Expand a {@link Rollout} into the ordered {@link Stage} list the
 * orchestrator state machine walks at runtime.
 *
 * Gradual rollouts: implicit `staging` first (traffic 0, no bake — staging
 * is a separate environment, not a traffic slice), then every declared
 * stage in order with its declared traffic + bake.
 *
 * Atomic rollouts: `staging` (traffic 0) followed by `atomic-prod` at 100%.
 * The bake on `atomic-prod` is null because the state machine treats atomic
 * as a single landing — there is no second transition to wait on.
 */
export const expand_rollout = (rollout: Rollout): Stage[] => {
	const staging: Stage = { name: "staging", traffic: 0, bake: null };
	if (rollout.type === "atomic") {
		return [staging, { name: "atomic-prod", traffic: 100, bake: null }];
	}
	const stages = rollout.stages.map((s): Stage => ({ name: s.name, traffic: s.traffic, bake: s.bake }));
	return [staging, ...stages];
};
