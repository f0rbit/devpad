# E2E Tests

End-to-end (page-level) tests for devpad using Playwright. The pipelines suite is the
actively-maintained, green set; see "Spec inventory" and "Known-broken specs" below.

## Quick Start

```bash
# Install the browser (first time only)
bunx playwright install chromium

# Run the full local suite (seeds the DB, then boots both servers)
bun run e2e:local

# Run only the green CI-gated selection (pipeline specs + pages.spec)
bun run e2e:ci
```

## Topology: local E2E is TWO servers

Local dev serves pages and the API from **two separate processes** — this is the single
most important thing to understand about this harness.

- **Astro frontend (`apps/main` / `@devpad/app`) — port `:3000`.** Serves all PAGES and
  is the Playwright `baseURL`. Its Vite dev proxy forwards `/api` + `/health` to the
  worker on `:3001` (`apps/main/astro.config.mjs`).
- **Worker API (`packages/worker`, `bun run dev`) — port `:3001`.** Serves ONLY
  `/api/v1/*` + `/health`. It 404s every page route.

Playwright's local `webServer` (`playwright.config.ts`) is therefore a **two-element
array** booting both, with `baseURL: http://localhost:3000`.

### Why two servers (the regression that forced this)

Commit `2255cb5` ("chore: delete packages/server (consolidated into worker)") removed
`packages/server`, which had been serving SSR pages on `:3001` via `app.use(ssrHandler)`

- `serveStatic`. It repointed the Playwright `webServer` at the API-only worker **without
  restoring page-serving** — silently 404ing the entire page suite. Because E2E was not in
  CI at the time, nobody noticed until the pipelines-e2e plan. The unified SSR+API server
  (`createUnifiedWorker`) does exist but is a _build artifact_ (`dist/_worker.js`), not
  wired into `bun run dev` — do not assume `:3001` serves pages.

The two-server `webServer` array mirrors `dev:all` exactly and un-rots the page suite
without any source changes.

## Fake auth

Fake auth lives in the Astro middleware (`apps/main/src/middleware.ts`), gated on
`NODE_ENV === "test"` OR `TEST_MODE === "enabled"`. The Astro `webServer` sets
`NODE_ENV=test` in its `env` block (NOT relied on from the shell), so fake auth is always
on under the harness; otherwise every page would redirect to login.

Specs inject the header `X-Test-User: true` via `context.route()` (see the
`inject_test_user` helper in `pipelines-smoke.spec.ts` / `pulse.spec.ts`). The middleware
resolves that header to user id **`test-user-e2e`** and session id **`test-session`**.
Fixture data must be owned by that user, and a matching `session` row must exist —
the worker does a real `validateSession` DB lookup on the forwarded
`Cookie: auth_session=test-session`.

## Seed model

```
bun run tests/e2e/seed.ts   # runs FIRST, under bun
playwright test ...         # then the specs, under node
```

- `tests/e2e/seed.ts` is a **standalone bun entrypoint** (exports `seed()`, runs on
  `import.meta.main`). It seeds the repo-root **`database/test.db`** — the same file the
  local worker `webServer` opens (`DATABASE_FILE=../../database/test.db`). NOTE: there
  are two `test.db` files in the repo; the harness uses `database/test.db`, NOT
  `tests/database/test.db`.
- It runs under bun, **not** via Playwright `globalSetup`. The seed imports `bun:sqlite`,
  and the `playwright` bin is node-shebang — a node-side `globalSetup` would throw
  `Received protocol 'bun:'`. So `e2e:local` / `e2e:ci` run the seed as a pre-step.
- The seed is **idempotent** (delete-then-insert on fixed ids), so repeated runs are
  safe. `migrateBunDatabase` creates + migrates the file if absent.
- Fixture ids live in `tests/e2e/fixtures/pipeline-ids.ts` — a **node-safe** module with
  NO runtime imports, so specs can import ids without pulling `bun:sqlite` into node. The
  bun fixture (`fixtures/pipelines.ts`) re-exports them (single source of truth). Key ids:
  user `test-user-e2e`, session `test-session`, project `e2e-pipe-project`, no-package
  project `e2e-pipe-no-pkg`.
- Run timestamps are anchored window-relative (`Date.now() - 2h`), not fixed calendar
  dates, so the dashboard's `started_at >= now - window` filter keeps counts deterministic
  (total=2, completed=1) as wall-clock advances.

## Local-scope limitations (NOT bugs)

The **local worker mounts only `/api/v1/pipelines/dashboard`**. The orchestrator routes
(`/runs`, `/runs/:id/approve`, `/analysis-templates`, `/runs/:id/events`, `/grants`,
`/pipelines/packages`) live in the separately-deployed orchestrator singleton and **404
locally**. Consequences:

- **Only the dashboard tab is data-backed locally.** The pipeline page
  (`pipeline.astro`) degrades gracefully: when `client.pipelines.packages.list()` returns
  a non-ok Result it renders the tabbed shell + a `data-testid="pipeline-degraded"` banner
  rather than 404ing. Because `packages.list()` always 404s locally, the pipeline page is
  **always in its degraded state** under the harness. Assert `pipeline-degraded` for the
  local render proof.
- **The true empty state shows as degraded locally.** The legitimate empty state
  (`packages.list` ok with zero packages → `pipeline-empty`) cannot be reproduced locally,
  because the 404 can't distinguish "no package" from "service down".
- **The run-detail page hard-404s locally — it does NOT degrade.**
  `pipeline/runs/[run_id].astro` `rethrow()`s on a non-ok `packages.list()`, so the whole
  page returns a clean 4xx. `StageGate` / `RunProgress` / `StageEventTimeline`
  render-or-wiring is NOT observable locally. Specs assert the page returns a clean 4xx
  (not a 5xx/crash), not that the widgets mount.
- **Pulse-unreachable is the local default**, not something to mock. The dashboard
  aggregator only fetches pulse when `pulse_api_base` + `pulse_internal_key` are
  configured; locally neither is set, so it returns `pulse: null` with no outbound
  request. Assert the dashboard renders its counts with `pulse: null` directly — a
  `route.abort()` on a pulse URL is a no-op false-green locally.

Full coverage of orchestrator round-trips (approve/deny verdict, analysis-template CRUD,
StageEventTimeline ingestion, grants actions) requires standing up the orchestrator
singleton locally — **out of scope** for this suite (see
`.plans/pipelines-e2e.html#out-of-scope`). Do NOT write round-trip specs against the
local worker; they false-green.

## Spec inventory

| Spec                          | Status     | Covers                                                 |
| ----------------------------- | ---------- | ------------------------------------------------------ |
| `pages.spec.ts`               | green      | basic page render smoke (todo, etc.)                   |
| `pipelines-smoke.spec.ts`     | green      | seeded pipeline page renders under fake auth           |
| `pipelines-dashboard.spec.ts` | green      | dashboard aggregated counts match the seed             |
| `pipelines-render.spec.ts`    | green      | tab render smoke, invalid-tab fallback, run-detail 404 |
| `pipelines-degraded.spec.ts`  | green      | degraded-shell + pulse-unreachable render              |
| `happy-path.spec.ts`          | **broken** | project-create workflow (see below)                    |
| `pulse.spec.ts`               | **broken** | pulse page (depends on project-create)                 |

## Known-broken specs (separate follow-up)

`happy-path.spec.ts` and `pulse.spec.ts` are **pre-existing failures, unrelated to
pipelines**, and are deliberately **excluded from `e2e:ci`**. Root cause: `/project/create`
renders no `#project_id` field under local fake auth (the project-create form selector
has drifted / the create flow rotted independently of the server topology). Phase 0 of
the pipelines-e2e plan restored page-serving so the page now returns 200, but the form
itself is still broken. Repairing it is tracked as a separate follow-up — do NOT fix it as
part of pipelines E2E work, and do NOT add these specs to `e2e:ci` until fixed.

## CI

E2E now runs in CI as a **dedicated, non-blocking `e2e` job** in
`.github/workflows/test.yml` (separate from the required `test` job). It runs
`bun run e2e:ci` (the green pipeline specs + `pages.spec`, excluding the broken
happy-path/pulse specs), installs Chromium with `--with-deps`, and uploads the Playwright
HTML report as an artifact on failure.

It is **NOT a required status check** — a red `e2e` does not gate merges. **Promotion
criterion:** add `e2e` to branch protection (making it required) only once it has been
observed stable across several CI runs.

## Test Environments

| Env                            | URL                          | Setup                                                                          |
| ------------------------------ | ---------------------------- | ------------------------------------------------------------------------------ |
| `local` (`TEST_ENV=local`)     | http://localhost:3000        | two-server harness (Astro :3000 + worker :3001), fake auth via `NODE_ENV=test` |
| `staging` (`TEST_ENV=staging`) | https://staging.devpad.tools | tests against deployed Cloudflare Workers; no `webServer`                      |

## Debugging failed tests

```bash
bunx playwright show-report .playwright/playwright-report     # last HTML report
bunx playwright show-trace .playwright/test-results/*/trace.zip
bun run e2e:local:ui                                          # UI mode
TEST_ENV=local bunx playwright test pipelines-smoke.spec.ts   # single spec
TEST_ENV=local bunx playwright test --headed                 # visible browser
```

## Configuration

See `playwright.config.ts`. Key settings: per-test timeout 45s, retries 2 on CI / 0
locally, workers 1 on CI, traces on first retry, Chromium only.
