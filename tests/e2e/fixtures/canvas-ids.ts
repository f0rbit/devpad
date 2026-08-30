/**
 * @module tests/e2e/fixtures/canvas-ids
 *
 * Fixed fixture ids for the P2.5 canvas-home E2E suite — a NO-runtime-import
 * module (same split rationale as `outline-ids.ts` / `density-ids.ts`).
 *
 * A dedicated project seeded with the ~500-node synthetic graph
 * (`apps/main/src/components/solid/canvas/__fixtures__/synthetic-graph.ts`)
 * so culling/LOD assertions have a stress-sized dataset without polluting the
 * outline/density fixtures' own node counts.
 */

export { E2E_SESSION_ID, E2E_USER_ID } from "./pipeline-ids";

export const E2E_CANVAS_PROJECT_ID = "e2e-canvas-project" as const;

/** matches `SYNTHETIC_TASK_COUNT` in the shared synthetic-graph fixture. */
export const E2E_CANVAS_TASK_COUNT = 500;
