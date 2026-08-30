/**
 * @module tests/e2e/fixtures/canvas-p3-ids
 *
 * Fixed fixture ids for the P3 canvas-home E2E suite (view-state, agent
 * placement, semantic travel). Deliberately a SEPARATE tiny project from
 * `E2E_OUTLINE_PROJECT_ID` — that fixture's graph spans many disconnected
 * clusters (milestones, ripple chains, stage tasks…) wide enough that
 * `camera.fit()`'s best-fit-of-4-discrete-levels can leave individual tasks
 * culled off-screen at load, which P3's drag/travel tests need to rule out
 * by construction rather than fight with viewport math.
 */

export { E2E_SESSION_ID, E2E_USER_ID } from "./pipeline-ids";

export const E2E_CANVAS_P3_PROJECT_ID = "e2e-canvas-p3-project" as const;

/** root phase — parent of both children below. */
export const E2E_CANVAS_P3_PHASE = "task_e2e-canvas-p3-phase" as const;
/** user-created child — the drag/pin/travel target. */
export const E2E_CANVAS_P3_CHILD = "task_e2e-canvas-p3-child" as const;
/** `created_by: "api"` child, unpinned — P3.3's placement/cue coverage. */
export const E2E_CANVAS_P3_AGENT_CHILD = "task_e2e-canvas-p3-agent-child" as const;
