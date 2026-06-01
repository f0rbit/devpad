/**
 * @module tests/e2e/fixtures/pipeline-ids
 *
 * Fixed fixture ids for the pipelines E2E suite, in a module with NO runtime
 * imports (crucially, no `bun:sqlite`). Specs run under Playwright's node-shebang
 * bin, which cannot load a `bun:` import; importing ids from here lets a spec
 * reference the seeded entities without dragging in the bun:sqlite seed stack.
 *
 * Single source of truth: `./pipelines.ts` (the bun-only seed module) re-exports
 * these, so the seed and the specs agree on every id.
 */

/**
 * The `X-Test-User: true` header maps to this id in the Astro middleware
 * (`apps/main/src/middleware.ts`). The fixture's project MUST be owned by it so
 * dashboard ownership checks pass under fake auth.
 */
export const E2E_USER_ID = "test-user-e2e" as const;
/**
 * Session id the Astro fake-auth middleware sets in test mode
 * (`locals.session = { id: "test-session" }`). The server API client forwards it
 * to the worker as `Cookie: auth_session=test-session`, and the worker validates
 * it against the `session` table — so the fixture MUST seed a matching row.
 */
export const E2E_SESSION_ID = "test-session" as const;
export const E2E_PROJECT_ID = "e2e-pipe-project" as const;
export const E2E_PKG_ID = "pipeline-package_e2e" as const;
export const E2E_RUN_COMPLETED = "pipeline-run_e2e-completed" as const;
export const E2E_RUN_AWAITING = "pipeline-run_e2e-awaiting" as const;
export const E2E_TEMPLATE_ID = "pipeline-analysis-template_e2e" as const;

/** The current stage of the awaiting run; the manual gate key must `.includes` it. */
export const E2E_AWAITING_STAGE = "atomic-prod" as const;
