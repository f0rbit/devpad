/**
 * @module tests/e2e/fixtures/density-ids
 *
 * Fixed fixture ids for the B2 graph-lens density evidence — a NO-runtime-import
 * module (same split rationale as `outline-ids.ts`: specs/scripts importing ids
 * must never accidentally pull in `bun:sqlite`).
 *
 * Dedicated project (not `e2e-outline-project`) so a ~30-node link graph never
 * shows up as noise in the other outline specs' own neighborhood assertions.
 */

export { E2E_SESSION_ID, E2E_USER_ID } from "./pipeline-ids";

export const E2E_DENSITY_PROJECT_ID = "e2e-density-project" as const;

/** BFS root — `near(FOCUS, 2)` reaches depth-1 + depth-2; `near(FOCUS, 3)` also reaches depth-3. */
export const E2E_DENSITY_FOCUS = "task_e2e-density-focus" as const;

export const E2E_DENSITY_DEPTH1_COUNT = 6;
export const E2E_DENSITY_DEPTH2_COUNT = 18;
export const E2E_DENSITY_DEPTH3_COUNT = 5;

export const density_depth1_id = (i: number): string => `task_e2e-density-d1-${String(i)}`;
export const density_depth2_id = (i: number): string => `task_e2e-density-d2-${String(i)}`;
export const density_depth3_id = (i: number): string => `task_e2e-density-d3-${String(i)}`;
