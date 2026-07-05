/**
 * @module pipeline-templates/gates
 *
 * Pure-data re-exports of the {@link Gate} discriminated union and the
 * three constructor helpers that keep template authors away from typing
 * raw object literals. Evaluator implementations (manual, auto, analysis)
 * live in `@devpad/core` so this package stays free of any runtime
 * dependencies.
 */

import type { AnalysisTemplateRef, Gate } from "./types";

export const manual = (): Gate => ({ type: "manual" });

export const auto = (opts?: { afterBake?: boolean }): Gate => ({
	type: "auto",
	...(opts?.afterBake !== undefined ? { afterBake: opts.afterBake } : {}),
});

export const analysis = (template: AnalysisTemplateRef): Gate => ({ type: "analysis", template });

export type { Gate } from "./types";
