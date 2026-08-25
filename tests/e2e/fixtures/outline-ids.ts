/**
 * @module tests/e2e/fixtures/outline-ids
 *
 * Fixed fixture ids for the v2.4 outline E2E suite, in a module with NO
 * runtime imports (no `bun:sqlite`) — see `pipeline-ids.ts` for why specs
 * import ids from here rather than from the bun-only seed module.
 */

export { E2E_SESSION_ID, E2E_USER_ID } from "./pipeline-ids";

export const E2E_OUTLINE_PROJECT_ID = "e2e-outline-project" as const;

/** phase (auto_children) — root-level, two direct children below. */
export const E2E_TASK_PHASE = "task_e2e-outline-phase" as const;
/** child of the phase — HIGH priority, claimed, IN_PROGRESS (advances to COMPLETED in interaction tests). */
export const E2E_TASK_CHILD_1 = "task_e2e-outline-child-1" as const;
/** child of the phase — LOW priority, UNSTARTED, blocked by the standalone leaf. */
export const E2E_TASK_CHILD_2 = "task_e2e-outline-child-2" as const;
/** standalone root-level leaf, blocks child-2 — exercises the rail's "blocked by" section. */
export const E2E_TASK_LEAF = "task_e2e-outline-leaf" as const;

/**
 * Dedicated auto_children parent + its one child, reserved for the
 * interactions spec's compaction scenario — kept separate from
 * phase/child-1/child-2/leaf so completing it (which replaces its children
 * with a compact summary row) can never race with another spec file's
 * assertions about those rows.
 */
export const E2E_TASK_COMPACT_PARENT = "task_e2e-outline-compact-parent" as const;
export const E2E_TASK_COMPACT_CHILD = "task_e2e-outline-compact-child" as const;

/** kind='milestone' root + one child task — the milestone lens' seeded fixture. */
export const E2E_TASK_MILESTONE = "task_e2e-outline-milestone" as const;
export const E2E_TASK_MILESTONE_CHILD = "task_e2e-outline-milestone-child" as const;

/**
 * Two-hop auto_children chain (grandparent -> parent -> leaf), reserved for
 * the ripple spec — completing the leaf bubbles both ancestors, giving a
 * real 2-hop chain to assert choreography/reduced-motion against without
 * racing the other specs' shared fixture rows.
 */
export const E2E_TASK_RIPPLE_GRANDPARENT = "task_e2e-outline-ripple-grandparent" as const;
export const E2E_TASK_RIPPLE_PARENT = "task_e2e-outline-ripple-parent" as const;
export const E2E_TASK_RIPPLE_LEAF = "task_e2e-outline-ripple-leaf" as const;

/** Single-hop auto_children pair dedicated to the reduced-motion scenario — independent of the 2-hop chain above so the two tests never race each other's completion. */
export const E2E_TASK_RIPPLE_REDUCED_PARENT = "task_e2e-outline-ripple-reduced-parent" as const;
export const E2E_TASK_RIPPLE_REDUCED_LEAF = "task_e2e-outline-ripple-reduced-leaf" as const;
