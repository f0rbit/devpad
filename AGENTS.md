# Development Guidelines for devpad Codebase

THIS PROJECT IS CALLED "devpad" NOT "DevPad". PLEASE UTILISE CORRECT CAPITLISATION: "devpad"

NEVER EVER DO A GIT PUSH/PULL OR MERGE/REBASE!!!!

Please don't be super agreeable with whatever I say - if you think there's an issue with my suggestions, push back & suggest better alternatives. I may be wrong upon occasion challenge me. But then once we've come to a decision - let's disagree & commit and move forward.

## Build & Test Commands
- Dev server: `bun dev` (root) or `cd apps/main && bun dev`
- Dev blog: `bun dev:blog` (port 3002)
- Dev media: `bun dev:media` (port 3003)
- Dev all services: `bun dev:all` (runs main app, worker API, blog, and media concurrently)
- Build all: `bun build` (builds all packages)
- Formatting guidelines are defined in `biome.json` - DO NOT RUN `bun lint:fix` - this will break astro imports
- Type check: `cd apps/main && bun check`
- Unit tests: `make unit` or `bun test unit`
- Integration tests: `make integration` (sequential) or `bun test integration/`
- Single test: `bun test path/to/test.test.ts`
- Coverage: `make coverage` then `make coverage-stats`
- Database migrate: `cd apps/main && bun migrate`

### Dev Server Ports
| Service | Port | Script |
|---------|------|--------|
| Main app | 3000 | `bun dev` |
| Worker API | 3001 | `bun dev:server` |
| Blog app | 3002 | `bun dev:blog` |
| Media app | 3003 | `bun dev:media` |

## Code Style & Architecture
- Naming: snake_case (variables), camelCase (functions), PascalCase (classes/types)
- Use one-word names when possible: `getProjects()` -> `projects.get()`
- Prefer nested objects over complex function names in interfaces
- Pure functions & composition over classes/inheritance
- Avoid if/else - use early returns instead
- Avoid try/catch - use errors as values with union types
- Max 5 layers indentation - refactor deeper nesting into smaller functions
- Builder pattern over large constructors (with sane defaults)
- Import using aliases when beneficial
- No comments except for complex business logic

## Suggested Development Workflow
1. **Define**: Generate types/schema/interfaces, ask for confirmation
2. **Test**: Create integration tests for actual use cases (not unit tests)
3. **Plan**: Layout implementation strategy based on interfaces & tests
4. **Implement**: Execute plan, validate against tests for completion

## Framework Guidelines
- Frontend: Astro + SolidJS (functional components)
- Backend: Bun + TypeScript (strict mode)
- Database: SQLite + Drizzle ORM
- Testing: Integration tests log to `packages/worker/server.log` (use `DEBUG_LOGGING="true"` for stdout)

## Repository Structure & Key Files
```
devpad/
├── apps/
│   ├── main/src/                              # devpad Astro frontend
│   │   ├── components/solid/                  # SolidJS components
│   │   ├── pages/                             # Astro pages
│   │   ├── layouts/                           # Page layouts
│   │   └── utils/api-client.ts                # Frontend API client instance
│   ├── blog/                                  # Blog Astro frontend
│   └── media/                                 # Media timeline Astro frontend
├── packages/
│   ├── api/src/
│   │   ├── api-client.ts                      # Main API client with Result-wrapped operations
│   │   ├── request.ts                         # HTTP client implementation
│   │   └── result.ts                          # Result wrapper for error handling
│   ├── cli/                                   # CLI tool for devpad
│   ├── mcp/                                   # MCP server for AI tool integration
│   ├── core/src/
│   │   ├── ui/                                # Shared frontend (SolidJS components, CSS, middleware)
│   │   │   ├── index.ts                       # Barrel: DevpadHeader, DevpadFooter, DevpadLogo, DevpadAuth
│   │   │   ├── styles/globals.css             # Shared CSS (@imports @f0rbit/ui/styles)
│   │   │   └── middleware.ts                  # resolveAuth() shared auth middleware
│   │   ├── services/
│   │   │   ├── projects.ts                    # Project management logic
│   │   │   ├── tasks.ts                       # Task operations
│   │   │   ├── scanning.ts                    # Code scanning functionality
│   │   │   ├── milestones.ts                  # Milestone management
│   │   │   ├── goals.ts                       # Goal tracking
│   │   │   ├── blog/                          # Blog service layer
│   │   │   └── media/                         # Media timeline service layer
│   │   │       └── platforms/                 # Provider pattern for media platforms
│   │   └── auth/
│   │       ├── lucia.ts                       # Lucia auth setup
│   │       └── oauth.ts                       # OAuth providers
│   ├── schema/src/
│   │   ├── types.ts                           # All TypeScript types and database models
│   │   ├── validation.ts                      # Zod schemas for runtime validation
│   │   ├── blog/                              # Blog types and corpus integration
│   │   └── database/
│   │       ├── schema.ts                      # Drizzle database schema
│   │       ├── full-schema.ts                 # Merged schema (devpad + blog + media)
│   │       ├── types.ts                       # Unified Database type
│   │       ├── d1.ts                          # D1 database constructor (production)
│   │       ├── bun.ts                         # Bun SQLite database constructor (dev/test)
│   │       └── migrate.ts                     # Database migrations
│   └── worker/src/
│       ├── bindings.ts                        # AppConfig, OAuthSecrets, Bindings types
│       ├── dev.ts                             # Dev server entry point
│       ├── routes/
│       │   ├── v1/                            # Main API routes (directory)
│       │   │   ├── blog/                      # Blog API routes
│       │   │   └── media/                     # Media API routes
│       │   └── auth.ts                        # Authentication routes
│       └── middleware/
│           ├── auth.ts                        # Auth middleware
│           ├── config.ts                      # Config middleware (c.env -> typed config)
│           └── context.ts                     # Blog/media context middleware
├── tests/
│   ├── integration/                           # Integration test suites
│   │   └── setup.ts                           # Server lifecycle (lazy init, shared)
│   └── shared/
│       ├── base-integration-test.ts           # setupIntegration() helper
│       ├── cleanup-manager.ts                 # Test resource cleanup (dependency order)
│       └── test-utils.ts                      # Test utilities and helpers
├── biome.json                                 # Code formatting config
├── Makefile                                   # Build and test commands
└── package.json                               # Root workspace config
```

## Database Type Architecture
- Single `Database` type defined in `packages/schema/src/database/types.ts`
- Uses `BaseSQLiteDatabase<"async", unknown, FullSchema>` -- works for both Bun SQLite (dev/test) and D1 (production)
- `FullSchema` merges devpad + blog + media schemas in `packages/schema/src/database/full-schema.ts`
- Only TWO casts exist in the entire codebase, both at construction boundaries:
  - `createD1Database` in `d1.ts` -- `as unknown as Database`
  - `createBunDatabase` in `bun.ts` -- `as unknown as Database` (sync-to-async bridge)
- All service functions in `packages/core/src/services/` take `db: Database`
- `drizzle-orm` is deduplicated via root `package.json` overrides (needed because `@f0rbit/corpus` has it as direct dep)
- Blog's `DrizzleDB` and Media's `Database` are both re-exports of the unified `Database` type

## Worker Architecture
- Routes NEVER read `c.env` -- all config comes from `c.get("config")` and `c.get("oauth_secrets")`
- `AppConfig` and `OAuthSecrets` types defined in `packages/worker/src/bindings.ts`
- `configMiddleware` reads `c.env` (Cloudflare bindings) and maps to typed config -- this is the ONLY place `c.env` is read for config
- D1/R2 conversion (Cloudflare resources to Drizzle + corpus backends) happens at the worker edge only (`middleware/context.ts`, `index.ts` scheduled handler)
- `packages/core` never imports Cloudflare types -- it only sees `Database` and corpus `Backend`
- D1/R2 bindings are optional in the `Bindings` type -- dev/test don't provide them
- `createApi(options)` accepts injectable `db`, `config`, `oauth_secrets`, `blogContext`, `mediaContext` -- dev/test inject directly, production reads from `c.env`

## Test Infrastructure
- Integration tests use `setupIntegration()` from `tests/shared/base-integration-test.ts` -- returns `{ client, cleanup }`
- Server lifecycle managed by `tests/integration/setup.ts` -- lazy init, shared across all test files
- `CleanupManager` handles test resource cleanup (projects, tasks, tags) in dependency order
- Dev server (`packages/worker/src/dev.ts`) constructs `AppConfig`/`OAuthSecrets` from `process.env`, injects via `createApi()` -- no fake `Bindings` object needed
- 300 tests: 62 unit + 238 integration

## Error Handling Patterns
- Core devpad services use `Result<T, ServiceError>` from `@f0rbit/corpus` with `ok()` and `err()`
- Blog services use `try_catch_async` from `@f0rbit/corpus` -- throws inside are caught by the wrapper and converted to Results (this is intentional, not a bug)
- Upsert operations use destructuring to exclude `id` field -- never use `delete` on the upsert object (destroys type safety)
- API client (`packages/api`) wraps all operations in `Result<T, ApiResultError>`

## Cross-App Navigation
- All 3 apps use shared `DevpadHeader` from `@devpad/core/ui` for row 1 (logo, nav, auth)
- Row 2 subnav (blog/media only) stays in each app's `.astro` layout (needs Astro's `class:list` directive)
- `DevpadHeader` generates URLs using domain grouping: main = projects/tasks/docs, blog = blog, media = media
- If a nav link's domain matches `currentApp`'s domain → relative URL, else → absolute cross-app URL
- `DevpadAuth` uses GitHub-branded login button when logged out; `variant="main"` shows "account" link, `variant="sub"` shows username
- Main's `GithubLogin.tsx` and `DevpadLogo.tsx` are thin re-export wrappers for backward compat (used by landing page, project/todo index)

## Blog-Project Integration
- Blog posts link to projects via `blog_post_projects` junction table
- Main app's `/project/[project_id]/blog` page fetches posts via `client.blog.posts.list({ project: id })`
- Blog editor accepts `?project=<uuid>` URL param to pre-select a project on new posts (`initialProjectIds` prop on PostEditor)
- Blog post list shows project badges as clickable links back to `https://devpad.tools/project/{name}`
- Blog post editor page shows linked projects as clickable pills

## CSS & @f0rbit/ui Convention
- `@f0rbit/ui` is the source of truth for design tokens AND utility classes (all 3 apps import `@devpad/core/ui/styles` which `@import`s `@f0rbit/ui/styles`)
- Apps no longer import `@f0rbit/ui/styles` directly -- it's included via `globals.css` in `@devpad/core/ui/styles`
- **Avoid adding custom CSS classes to `globals.css`** -- use `@f0rbit/ui` classes, components, and inline styles instead. Read `https://f0rbit.github.io/ui/llms.txt` for the full API.
- App-specific tokens that DON'T come from `@f0rbit/ui`: `--text-link`, `--hover-filter`, `--input-placeholder`, `--input-focus`, `--item-red`, `--item-green`, `--item-red-border`, `--item-green-border`
- When writing new CSS, use `@f0rbit/ui` token names (`--fg`, `--bg`, `--accent`, `--border`, `--bg-alt`, `--fg-muted`, `--fg-subtle`, `--fg-faint`, etc.)
- NEVER use legacy token names (`--bg-primary`, `--text-primary`, `--text-secondary`, `--input-background`, `--input-border`) -- they have been fully removed from the codebase

### @f0rbit/ui Utility Class Composition (CRITICAL)
Layout utilities use a **base + modifier** pattern. Modifiers only set CSS variables — they do NOT include `display: flex`. You MUST always include the base class:
- `.stack` = `display: flex; flex-direction: column; gap: var(--stack-gap, var(--space-md))`
- `.stack-sm` = MODIFIER ONLY, sets `--stack-gap: var(--space-sm)` — **must pair with `.stack`**
- `.stack-lg` = MODIFIER ONLY, sets `--stack-gap: var(--space-lg)` — **must pair with `.stack`**
- `.row` = `display: flex; flex-direction: row; align-items: center; gap: var(--row-gap, var(--space-sm))`
- `.row-sm` = MODIFIER ONLY, sets `--row-gap: var(--space-xs)` — **must pair with `.row`**
- `.row-lg` = MODIFIER ONLY, sets `--row-gap: var(--space-md)` — **must pair with `.row`**
- `.row-between` = MODIFIER ONLY, sets `justify-content: space-between` — **must pair with `.row`**
- `.row-end` = MODIFIER ONLY, sets `justify-content: flex-end` — **must pair with `.row`**
- `.row-start` = MODIFIER ONLY, sets `align-items: flex-start` — **must pair with `.row`**

Correct: `class="row row-sm"`, `class="stack stack-lg"`, `class="row row-between"`
WRONG: `class="row-sm"`, `class="stack-lg"`, `class="row-between"` (no flex layout applied!)

## SSR Data Fetching Conventions
- Variable name for API client: `client` (one word, all apps)
- Main app project pages: use `getProject(Astro)` from `@/utils/api-client` for the guard pattern (validates params, auth, ownership — returns `{ client, project, user }` or `Response`)
- Parallel fetches: use `Promise.all()` for independent API calls, destructure results
- Error handling by app:
  - Main: `rethrow()` from `@/utils/api-client` (returns HTTP Response with error code)
  - Blog: local error strings rendered in template
  - Media: try/catch with silent fallback to client-side fetch
- `getServerApiClient()` is in `packages/core/src/ui/api-client.ts` (shared across all 3 apps)

## Known Pre-existing LSP Errors
These type errors exist and should be ignored:
- `CategoryServiceError`/`PostServiceError` type mismatches in blog routes
- `packages/worker/src/index.ts` fetch type signature
- `packages/schema/src/validation.ts` regex pattern
- `showSuccessToast` in `OptimisticTaskProgress.tsx`
- Astro check false positives: `rethrow` and `getProject` sometimes reported as unused despite being used

## AI Provenance & Protection System

### Entity Provenance
- `provenance()` schema helper adds `created_by` and `modified_by` columns (enum: "user" | "api", default "user") plus `protected` boolean (default false)
- `provenance()` → `entity()` → `owned_entity()` — adding columns to `provenance()` cascades to ALL entity tables
- Auth middleware sets `auth_channel` ("user" for session cookies, "api" for Bearer tokens) in Hono context
- All 4 upsert services (tasks, projects, milestones, goals) accept `auth_channel` and write it to `created_by`/`modified_by`
- Action table has a `channel` column recording which auth path created the action

### Protected Entity Policy
- Entities edited by a user (`auth_channel == "user"`) are auto-protected (`protected = true`)
- API-channel writes to a protected entity are rejected with 409 Conflict unless `force: true` is passed
- `force: true` clears the protection flag — the entity becomes unprotected again
- `ProtectedError` type and `isProtectedError()` guard in `packages/schema/src/errors.ts`
- `force` is a validation-only field — must be destructured out before DB write: `const { id, force: _force, ...fields } = data;`

### AI Activity Feed
- `GET /activity/ai` returns sessions of API-channel actions grouped by 10-minute time gaps
- `getAIActivity()` in `packages/core/src/services/action.ts`
- `activity.ai()` on the API client, `devpad_activity_ai` MCP tool

### AI Provenance UI
- `AiProvenance` component in `packages/core/src/ui/ai-provenance.tsx` — shared across all 3 apps
- Uses oklch purple (hue 290) via `.ai-provenance` CSS class in `globals.css`
- Entity-level: `created_by`/`modified_by` fields on Task, Project, Milestone, Goal → renders purple Bot icon
- Action-level: `channel` field on HistoryAction → Bot icon rendered directly in HistoryTimeline

### Milestone/Goal Ownership
- Milestone and goal tables use `entity()` not `owned_entity()` — no `owner_id` column
- Ownership is checked via the parent project
- Provenance columns (`created_by`, `modified_by`, `protected`) still apply via `provenance()` in `entity()`

## Project Context
- `sessionStorage` key: `devpad_project_context` — stores `{ id, name }` for current project
- Set by `ProjectContextSetter` component on project pages (`client:load`)
- Read by `TaskSorter` (initial filter) and `TaskEditor` (default project)
- Cleared on `/project` index page (project list)

## Cloudflare API Integration (Phase 6 — Workers Versions multipart upload)

- Versions API requires `multipart/form-data`: `metadata` part (JSON) + script as file part (`application/javascript+module`). JSON POST is rejected.
- Only `workers/message`, `workers/tag`, `workers/alias` are allowed annotation keys on `metadata`. Custom keys return error 10021. We use `workers/tag` for `version_set_id`.
- Service binding `entrypoint` field on metadata.bindings only resolves to NAMED class exports. Default exports need no `entrypoint` field — mis-setting it causes "entrypoint name not found in this worker" at runtime.
- When bundling Worker code from outside wrangler (e.g. orchestrator pre-deploy build): use `--external cloudflare:*`, NOT `--packages=external`. The latter externalises everything (npm deps) including `zod` etc. and breaks at runtime with "No such module".
- `ctx.id.toString()` returns hex; use `ctx.id.name` when round-tripping a string id supplied via `idFromName`. See `packages/pipelines/src/run-do.ts`.
- CLI spinners (`ora`) are silent in non-TTY (CI) — `.fail(...)` is a no-op. Always also `console.error(message)` alongside `spinner.fail(...)`. The shared printer in `packages/cli/src/printer.ts` handles this correctly.
- Scaffolded workflows need `actions/setup-node@v4` with `node-version: 22` because wrangler v4 requires Node 22. `oven-sh/setup-bun` alone is not sufficient.

## Pulse Integration

devpad federates with `@f0rbit/pulse` (analytics + observability, separate Cloudflare Worker; source: `~/dev/pulse`). The integration is server-to-server only — admin keys never reach the browser.

### Auth + scope
- `api_keys.scope` enum includes `"pulse"` (added in migration `0007_add_pulse_scope.sql`). Use this scope when issuing keys for analytics access; `"all"` is a superset.
- `AppVariables.api_key_scope` is `null` for cookie-auth (browser sessions) and a scope literal (`"pulse"`, `"all"`, etc.) for API-key auth. Routes that branch on scope must handle `null`.
- `getUserAndScopeByApiKey()` in `packages/core/src/auth/keys.ts` returns both user_id and scope; auth middleware exposes scope via `c.set("api_key_scope", ...)`.

### Worker proxy — `/v1/pulse/*`
- `packages/worker/src/routes/v1/pulse.ts` is a server-to-server forwarder. It holds `pulse_internal_key` (config-injected) and forwards to `pulse_api_base` after rewriting `/v1/pulse/<rest>` → `/<rest>`.
- Ownership enforcement is per-route via `doesUserOwnProject` from `packages/core/src/services/projects.ts`. Pulse trusts whatever devpad forwards — the boundary is here, not upstream.
- 60s edge cache on `GET /summary | /errors | /logs | /latency`. None on `/events` or `/admin/*`.
- Pulse-unreachable (fetch failure or network 502) maps to 503 with `{ error: "pulse_unreachable" }`. Treat 503 as "pulse not deployed yet," not as an error in dashboard pages.

### ApiClient — `client.pulse.*`
- `client.pulse.{summary, events, errors, logs, latency}` for reads, `client.pulse.subs.*` for subscription CRUD, `client.pulse.keys.*` for ingest-key issuance. All return `ApiResult<T>` (devpad's existing wrapper).
- All methods hit devpad's `/v1/pulse/*` proxy — they do NOT call pulse directly. Public site never sees pulse's URL or admin keys.
- **Rebuild `@devpad/api` after editing `packages/api/src/api-client.ts`.** `apps/main` consumes `dist/index.d.ts`, not source. Run `cd packages/api && bun run build` before typechecking dependent packages or you'll see stale type errors.

### MCP tools
8 tools in `packages/api/src/tools.ts`: `devpad_pulse_summary`, `devpad_pulse_events`, `devpad_pulse_errors`, `devpad_pulse_logs`, `devpad_pulse_latency`, `devpad_alerts_list`, `devpad_alerts_subscribe`, `devpad_alerts_unsubscribe`, `devpad_pulse_key_create`. Same Zod schema → tool description pattern as the rest of `tools.ts`.

### Dashboard
- `apps/main/src/pages/project/[project_id]/pulse.astro` — server-rendered Astro shell with five tabs (overview / errors / logs / requests / subscriptions). Tab state is URL-driven (`?tab=...`) for deep-linkability.
- Per-tab components live in `apps/main/src/components/solid/pulse/`. Use `client:visible` for read-only tabs and `client:load` only for the subscriptions tab (which mounts an interactive form). Do NOT use `client:only="solid-js"` — server-rendering preserves the empty-state SDK install snippet and the unreachable-503 fallback.
- `apps/main/src/components/solid/project/PulseWidget.tsx` is a compact widget on the project overview page (KPIs + 7-day sparkline; click → `/project/[id]/pulse`).
- Empty state shows the SDK install snippet using `import.meta.env.PUBLIC_PULSE_INGEST_URL` (default `https://pulse.devpad.tools`). When adding new public-side env vars, document them here and in wrangler config.

## Cross-Repo Invariants (Phase 7+)

- CF service bindings do NOT propagate `vars` from caller's env to callee's env. Identity (and any other caller-attributed metadata) must travel as an explicit RPC argument. See `~/dev/vault/src/handler.ts` — `messages.create(input, identity)` shape is the canonical example.
- When binding to a named `WorkerEntrypoint` via Alchemy: use `{ type: "service", service: "...", __entrypoint__: "ClassName" }` directly. Alchemy's public `WorkerRef()` factory drops the `entrypoint` field. Known limitation as of v0.93.7.
- `CALLER_ENV` is the canonical caller-environment env var name (NOT `CALLER_ENVIRONMENT`). Vault reads it; orchestrator writes it. `caller-identity.ts:62`'s `environment_for_stage` maps every stage to `"staging"` or `"production"` — those are the only two values you'll ever see.

## Drizzle / D1 Invariants (Phase 8+)

- RPC entrypoint classes binding `env.DB` (raw `D1Database`) must wrap via `createD1Database(env.DB)` before passing to drizzle-typed services. Raw bindings produce `db_error` at runtime because drizzle's query builder is undefined on raw bindings. See `packages/pipelines/src/grants-rpc-entrypoint.ts` cached-wrap pattern.
- Pipeline grants must exist (in `pipeline_grant` table) before vault calls succeed. Default seed needed per (package, stage_name, scope) tuple. With `CALLER_ENV` resolving to only `staging|production`, stage_name should be one of those two values.

## Pipeline Run Semantics (Phase 9)

- Analysis gates fail OPEN: when `pipeline_analysis_template` row is missing for a gate's `template_id`, the evaluator returns `{ verdict: "Pass", reason: "no_template_configured" }` + emits a pulse `gate_analysis_no_template` event. To get fail-closed behaviour, populate a real template row. Implicit "default" template doesn't exist.
- `pipeline_run.kind` is `"deploy" | "rollback"`. Rollback runs are spawned by `POST /runs/:id/rollback` even from terminal states; they target the predecessor version-set via corpus lineage and use atomic shape + auto gate. They're separate run rows with their own audit trail.
- `wrangler d1 migrations apply` requires a user-level token with `User Details: Read`. The resource-scoped `CF_API_TOKEN` in `.env` (sized for Alchemy) lacks it. Workaround: `bunx wrangler d1 execute <db_name> --remote --file <migration.sql>` from a context where the OAuth profile is used, then `INSERT INTO d1_migrations` manually.

## Pulse Integration (Phase 11)

- Pulse ingest contract: `POST /e` with header `X-Pulse-Key: pk_*`. Body `{ project_id, events: [...] }` where each event has discriminator `name`. Vault + scaffolder template use the `custom_event` shape: `name: "event"`, per-version dimensions (`package`, `environment`, `version_id`) hoisted to top level so pulse's `GET /summary` can group on them; everything else under `properties`. See `~/dev/vault/src/pulse-emitter.ts` for canonical impl.
- Corpus version-set lineage: orchestrator's `POST /artifacts/version-set` stamps `parents: [{ store_id: "version-sets", version: <latest>, role: "predecessor" }]` from latest uploaded version-set for the package. `version_sets.lineage(version)` walks the chain. Required for rollback semantics.
- Demo repos vs scaffolder: the scaffolder template (`packages/pipeline-templates/src/scaffolder/templates/`) is the source-of-truth. Existing demos in separate repos must be hand-synced when the template changes — no automated drift detection.

## Singleton Platform Model (Phase 12)

- Platform services (pulse, vault, devpad-pipelines) are deployed ONCE — observability and control plane don't need staging/production splits. Workload Workers (scaffolded packages) DO have staging/production splits. `caller.environment` (from RPC identity arg) is the canonical marker; vault grants honor it; pulse events tag with it.
- Shared `default_secrets_store` cascade on Alchemy destroy: when multiple Alchemy apps adopt the same store and one destroys its stage, the store can cascade-delete if it ends up empty — taking other apps' live secret bindings with it. Workaround: after a destroy, immediately re-deploy any production stage whose Alchemy state references the shared store. Long-term: each app gets its own store, blocked by CF account-level 1-store cap.
- Tombstone audits must check Cloudflare runtime telemetry, not just source-tree grep. Phase 13.B found two SST-era D1s with read traffic despite zero source references — turned out to be zombie SST-era Workers still deployed. Use the CF API to enumerate Workers per resource binding before deleting any resource.

## Worker Renames (Phase 13.C)

- CF Worker renames preserve service bindings transparently — consumers pointing at the old name keep working without a redeploy because CF resolves bindings by internal tag, not literal name. Safest rename pattern is in-place (just change the `name` field on the Alchemy Worker resource).
- Alchemy `Worker(id, { name })` rename pitfall: declaring a "legacy" Worker resource alongside the rename triggers a `rename + create` mess (phantom state). DON'T do blue-green via parallel Alchemy resources. Also: rename detaches secondary resources (custom domains, queue consumers, cron triggers, service bindings) — re-attach via the next deploy. The bindings ON the renamed Worker may be lost; check via API after rename.

## Phantom Deps (Phase 13.D)

- `@devpad/api`'s compiled `dist/` has a phantom dep on `drizzle-orm`: tsup inlines `@devpad/schema`'s database code (which imports drizzle-orm) but leaves the import external. The dep is declared on `@devpad/api`'s package.json so downstream bundlers can resolve it. Don't drop it from api's `dependencies` even though api's own source doesn't reference drizzle-orm directly.

## Wire Envelope Contract (Phase 13.E)

- Orchestrator HTTP API uses `{ ok: true, value }` for success and `{ ok: false, error: { code, message?, ...details } }` for failure. Discriminator is `code`, not `kind`. Service-layer Results use `kind` (corpus convention); the route boundary normalises via `to_wire_error()` in `packages/pipelines/src/routes.ts`. Never `json_err(status, result.error)` — use `wire_err(result.error)` so the envelope is single-wrapped.
- `CallerIdentity.package_id` is the canonical field name (renamed from `package` in Phase 13.E2). DB column is `pipeline_run.package_id`. Route bodies use `package_id`. The only asymmetry: pulse's `events.package` column stays as-is (pulse's storage contract); vault's `pulse-emitter.ts` translates `caller.package_id` → wire `package` at emission. Comment in `pulse-emitter.ts` marks the translation site.

## Hono Gotchas
- **`c.req.url` and `c.req.method` are getters, not functions.** `c.req.url()` typechecks (`Function.prototype.toString` exists) but TypeErrors at runtime. Same with `method`. Phase 3 verification caught a real instance of this in the pulse proxy.

## Test Runner Gotchas
- `bun test` from repo root loads Playwright `.spec.ts` files and fails them with "Playwright Test did not expect test.describe() to be called here". This is a pre-existing fail-mode and the correct invocation is `bun run e2e:local` (which spins up a dev server). New e2e specs inherit this fail-mode — don't try to "fix" it by changing `bun test` config.

# Debugging
When running integration tests, logs will get piped to `packages/worker/server.log`, only read the logs if you're looking for errors.

In the case where you want logs in stdout, specify the exact test suite you want to run in the command using bun specifically rather than `make integration` & pass `DEBUG_LOGGING="true"` as an env variable to the function.
