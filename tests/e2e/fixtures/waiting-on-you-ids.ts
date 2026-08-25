/**
 * @module tests/e2e/fixtures/waiting-on-you-ids
 *
 * Fixed fixture ids for the "Waiting on you" (task B2.4) e2e spec, in a
 * module with NO runtime imports — same node-safe-re-export split as
 * outline-ids.ts.
 */
export { E2E_OUTLINE_PROJECT_ID as E2E_WAITING_PROJECT_ID, E2E_SESSION_ID, E2E_USER_ID } from "./outline-ids";

/** kind='approval' task the seeded signoff checkpoint hangs off of. */
export const E2E_TASK_WAITING_SIGNOFF = "task_e2e-waiting-signoff-task" as const;
export const E2E_SIGNOFF_ID = "signoff_e2e-waiting-signoff" as const;
