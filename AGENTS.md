# Development Guidelines for devpad Codebase

THIS PROJECT IS CALLED "devpad" NOT "DevPad". PLEASE UTILISE CORRECT CAPITLISATION: "devpad"

Please don't be super agreeable with whatever I say - if you think there's an issue with my suggestions, push back & suggest better alternatives. I may be wrong upon occasion challenge me. But then once we've come to a decision - let's disagree & commit and move forward.

## Build & Test Commands

- Dev server: `bun dev` (root) or `cd apps/main && bun dev`
- Dev blog: `bun dev:blog` (port 3002)
- Dev media: `bun dev:media` (port 3003)
- Dev all services: `bun dev:all` (runs main app, worker API, blog, and media concurrently)
- Build all: `bun build` (builds all packages)
- Formatting guidelines are defined in `biome.json` - DO NOT RUN `bun lint:fix` - this will break astro imports. biome stays the formatter/linter for `.astro` only (oxfmt has no Astro support -- confirmed via `.prettierignore`'s `**/*.astro` exclusion and root `eslint.config.ts`'s `ignores: ["**/*.astro"]`); full biome removal is a tracked follow-up (devpad task `task_bbedd518-ebde-4172-be2f-a6b719ac1eba`, "biome/astro formatter decision") once oxfmt/oxlint ship Astro support upstream.
- `bun run lint` is the `@f0rbit/lint` toolchain (oxlint + typed eslint), not biome — the old biome-backed `lint` (read-only check) was renamed to `bun run lint:biome`; `bun run lint:fix` is untouched and still biome (still subject to the astro-imports caution above). See "Lint/format wiring (devpad's OWN repo...)" below for the full picture; the toolchain is now a **required CI gate** (`.github/workflows/test.yml`'s `Lint` step, blocking) — `bun run lint` must exit 0 before merging
- Type check: `cd apps/main && bun check`
- Unit tests: `make unit` or `bun test unit`
- Integration tests: `make integration` (sequential) or `bun test integration/`
- Single test: `bun test path/to/test.test.ts`
- Coverage: `make coverage` then `make coverage-stats`
- Database migrate: `cd apps/main && bun migrate`

### Dev Server Ports

| Service    | Port | Script           |
| ---------- | ---- | ---------------- |
| Main app   | 3000 | `bun dev`        |
| Worker API | 3001 | `bun dev:server` |
| Blog app   | 3002 | `bun dev:blog`   |
| Media app  | 3003 | `bun dev:media`  |

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
- `drizzle-orm` is deduplicated via root `package.json` overrides
- Blog's `DrizzleDB` and Media's `Database` are both re-exports of the unified `Database` type

## Pipelines module

The `packages/pipelines/` Worker is a separate Cloudflare Worker (not part of `devpad-unified`), exporting a `PipelineRunDO` Durable Object and a Hono REST API. The Worker holds **no upstream API keys** — all third-party traffic crosses the security boundary into `~/dev/vault` (separate repo, **same Cloudflare account** — the boundary is logical, enforced by the service-binding RPC contract and the secrets-store secret name `ANTHROPIC_API_KEY`). The orchestrator hosts the grants registry (`pipeline_grant` table) and exposes a `grants.check(caller, scope)` RPC that vault calls.

### Platform singleton model (Phase 12)

Platform services (`pulse`, `vault`, `devpad-pipelines`) are deployed ONCE — they're control plane (observability backplane, secret broker, orchestrator), not workloads-under-test. Their staging Workers were decommissioned in Phase 12. Stage scoping is enforced at:

- **vault**: `caller.environment` on the RPC identity arg (Phase 7) — `grants.check(...)` matches against this literal.
- **pulse**: `environment` tag on each event body — events from staging and production callers all land in `pulse-db-production` but are queryable by tag.

Workload Workers (scaffolded packages such as `anthropic-search`, `anthropic-summarize`) **do** keep the staging+production split. Only the upstream platform service bindings collapse to singletons (`vault`, `pulse-api` — renamed from `vault-production` / `pulse-api-production` in Phase 13.C).

### Deployed Workers (Cloudflare)

| Service      | Worker name        | URL                                                                   | Singleton |
| ------------ | ------------------ | --------------------------------------------------------------------- | --------- |
| Orchestrator | `devpad-pipelines` | `https://devpad-pipelines.dev-818.workers.dev`                        | yes       |
| Vault        | `vault`            | (RPC-only, no public URL)                                             | yes       |
| Pulse        | `pulse-api`        | `https://pulse-api.dev-818.workers.dev` (custom `pulse.devpad.tools`) | yes       |

Deploy via Alchemy from the **devpad repo root**:

```
ALCHEMY_CI_STATE_STORE_CHECK=false bunx alchemy deploy ./packages/pipelines/infra.ts --stage production --env-file ./.env --profile default
```

The orchestrator deploys with `--stage production` only. The `--stage staging` path was removed in Phase 13.C — `infra.ts` no longer branches on the stage; it always binds the production D1 + R2. The deploy adopts (never creates) the existing `devpad-unified-db` D1 and `devpad-corpus` R2 bucket shared with the main `devpad-unified` Worker.

### Deploy gotchas (carry-over from vault)

- **Drop `"rpc"` from `compatibilityFlags`.** It became a default 2024-04-03 and Cloudflare rejects the deploy if specified explicitly.
- **Use the Alchemy OAuth profile `default`** (configured via `bunx alchemy configure`), not the limited `CLOUDFLARE_API_TOKEN` in `devpad/.env`. That env var is commented out for this reason.
- **Account is capped at one `default_secrets_store`.** When binding a `Secret`, use `SecretsStore("<id>", { name: "default_secrets_store", adopt: true })`. The pipelines Worker has no Secrets bound today, so this doesn't apply yet — but vault does, and any future pipelines secrets must adopt the same store. Bound secrets are scoped by name; the boundary is preserved at the secret level.
- **`ALCHEMY_PASSWORD` (in devpad/.env) is only required when Alchemy persists Secret values in state.** Pipelines doesn't bind any secrets currently. Generate with `openssl rand -hex 32` and keep stable across deploys if a future deploy adds secrets.
- **Tokens in test logs**: when an agent runs a test call that uses a bearer token (CF API, devpad PIPELINES_TOKEN, pulse ingest key, etc.), the full token should NEVER appear in command output that gets captured by the agent's transcript. Use parameter substitution + redact in echoed commands: e.g. `echo "TOKEN=${TOKEN:0:6}…${TOKEN: -4}"` not `echo $TOKEN`. This prevents tokens from being exposed in the orchestrator-phase outputs and permanent logs. If captured, treat as compromised and rotate.

### Cloudflare API integration gotchas (Phase 6)

The `CloudflareProvider` lives in `packages/pipeline-fakes/src/cloudflare/` with an HTTP-backed implementation (`http.ts`) hitting the Cloudflare REST API directly. Subtleties surfaced during the Phase 6 conversion to the live account:

- **Workers Versions API uses `multipart/form-data`, not JSON.** A version upload is a multipart body with a `metadata` part (`Content-Type: application/json` for the script metadata) plus one or more file parts for the script + any modules. Posting JSON returns a 400 immediately. The provider builds the body via `FormData` + a `Blob` for the script contents — see `cf-api-multipart.test.ts` for the exact wire shape.
- **Only `workers/message`, `workers/tag`, and `workers/alias` are valid annotation keys** when uploading a version. Other keys (e.g. `version_set_id`, `git_sha`) return Cloudflare error 10021 ("annotation key not recognised") and the version doesn't upload. If you need to thread a custom identifier through, encode it into `workers/tag` (it's free-form) and parse client-side.
- **Service binding `entrypoint` only resolves named class exports.** When binding to a `WorkerEntrypoint` subclass (e.g. `PipelinesGrantsEndpoint`, `AnthropicVault`), you MUST set `entrypoint: "ClassName"` in the binding spec — without it, Cloudflare binds to the default export and any RPC method call returns "The RPC receiver does not implement the method '...'". Alchemy's `WorkerRef` factory drops the `entrypoint` field; pass `{ type: "service", service: "...", __entrypoint__: "ClassName" }` directly until the public API exposes it.
- **Use `--external cloudflare:*` when bundling without wrangler.** The `cloudflare:workers` and `cloudflare:sockets` imports are resolved by the Workers runtime, not by your bundler. Bun/esbuild treat them as missing modules unless explicitly externalised. `--packages=external` is the wrong knob here — it excludes node_modules, not virtual imports.
- **`DurableObjectId.toString()` returns hex, not the original name.** If you constructed the id via `namespace.idFromName("run_abc")` and need the original `"run_abc"` back, read `id.name` (only set when the id originated from `idFromName`). Round-tripping through `toString()` loses it. The DO router relies on this for the `/runs/:id` route.
- **CLI spinners are silent in non-TTY environments (CI logs).** `ora` and similar libraries detect `process.stdout.isTTY` and degrade to no-ops. Always emit a parallel `console.error(message)` so CI logs surface the same status updates.
- **Pin Node 22 in CI for wrangler v4.** Wrangler v4 requires Node ≥ 22.16; older runners install Node 18 by default and the deploy fails on a `module not found` for `node:worker_threads`. The pipelines workflow sets `actions/setup-node@v4` with `node-version: 22.16.0` explicitly.

### Cross-repo service-binding wiring (two-pass deploy)

Vault and pipelines bind to each other:

- vault → pipelines: `GRANTS` (RPC entrypoint `PipelinesGrantsEndpoint`), `PULSE` service binding
- pipelines → vault: `ANTHROPIC` (RPC entrypoint `AnthropicVault`), `PULSE` service binding

Post-Phase 12/13.C there is only one pulse Worker on this account, `pulse-api` (renamed from `pulse-api-production` in Phase 13.C; the `pulse-api-staging` variant was decommissioned in Phase 12). All callers — workloads at either stage and platform services — bind to `pulse-api` and tag events with their own `environment`.

First-time setup uses a two-pass deploy to break the circular dependency: deploy vault without the bindings (vault's `infra.ts` gates `GRANTS` + `PULSE` behind `WIRE_GRANTS_BINDING=true`), deploy pipelines normally (its bindings to vault resolve at upload time since vault already exists), then re-deploy vault with `WIRE_GRANTS_BINDING=true`. Subsequent deploys of either repo don't need the gate — both Workers exist.

### Cross-repo invariants (Phase 7)

- **CF service bindings do NOT propagate `vars` from caller to callee.** When Worker A (with `CALLER_PACKAGE=foo`, `CALLER_ENV=staging` in its env) calls Worker B via a service binding, Worker B's `env` contains its OWN vars, not A's. Identity must travel as an explicit RPC argument on every method — never via shared env. The vault repo enforces this via `messages_create(input, identity)` where `identity` is the caller's `{ package, environment, version_set_id }` resolved client-side from the caller's own env.
- **Alchemy's public `WorkerRef` factory drops the entrypoint field.** Workaround: construct the binding object directly with the internal `__entrypoint__` key — `bindings.GRANTS = { type: "service", service: pipelines_service, __entrypoint__: "PipelinesGrantsEndpoint" } as ReturnType<typeof WorkerRef>`. This is a known limitation of alchemy as of 0.93.x; when it ships the field publicly, swap back to the typed factory.
- **`CALLER_ENV` is the canonical key, NOT `CALLER_ENVIRONMENT`.** Each caller Worker reads its own stage from `env.CALLER_ENV` (defined per stage in its own infra/wrangler config). `caller-identity.ts:62` in pipelines maps stage values to two literals only: `staging` or `production`. The grants registry keys against these exact strings; anything else (e.g. `prod`, `live`, `preview`) won't match a grant and the call denies.

### Architecture rules

- **DO holds no business logic.** If you're writing transition logic inside `make_run_handler`, push it down into `@devpad/core/services/pipelines/runs.ts`.
- **State machine is pure.** `state-machine.ts` is deterministic — no clock, no random, no IO. Side effects belong in `runs.ts`.
- **Resolved rollout/gates JSON in `pipeline_run`** is the source of truth for in-flight runs, not the template files. Template edits don't affect running pipelines.
- **Forced-atomic gates fallback.** When the discriminator rewrites a declared `gradual` to `atomic` (DO migrations or unaffinitised assets), `resolve_run_plan` falls back to `defaultAtomicGates` since the declared gate map's transition keys no longer apply.

### Database

The pipelines module reuses the unified `Database` type — pipeline tables (`pipeline_*`) sit in the same D1 instance. Migrations land under `packages/schema/src/database/drizzle/` like everything else. The vault repo (`~/dev/vault`) does NOT bind to this D1; vault reaches grants exclusively through the pipelines `grants.check` RPC.

### Drizzle / D1 invariants (Phase 8)

- **RPC entrypoints that bind `env.DB` must wrap via `createD1Database(env.DB)` before passing to drizzle-typed services.** Raw `D1Database` bindings produce `db_error` at the first query because drizzle's typed accessor (`db.select()....`) expects the wrapped shape. The cached-wrap pattern lives in `grants-rpc-entrypoint.ts:35` — instantiate the wrapper once per entrypoint instance and reuse for subsequent calls.
- **Post-Phase 12/13.C the orchestrator is a singleton (`devpad-pipelines`) bound to `devpad-unified-db`.** Grants rows + run history live in production-only. The orchestrator's `--stage staging` path was removed in Phase 13.C — `packages/pipelines/infra.ts` hardcodes `devpad-unified-db` + `devpad-corpus` + `ENVIRONMENT: "production"`. A future canary deploy of the orchestrator would need re-introducing a stage discriminator.
- **Pipeline grants must exist BEFORE vault calls succeed.** Vault's grant check is fail-closed: if no `pipeline_grant` row matches `(package, environment, scope)`, the call denies with no escalation. Default seed for a new demo package is one row per stage: `(package, "staging", "anthropic:messages")` + `(package, "production", "anthropic:messages")`. The `environment` column only ever holds those two literals (matching `CALLER_ENV`'s two values) — `dev`, `preview`, etc. simply won't match.

### Testing

- Pipeline tests use the `@devpad/pipeline-fakes` package for in-memory Cloudflare / GitHub / Anthropic / DurableObject substitutes.
- Test DB harness pattern: `packages/core/src/services/pipelines/__tests__/integration/helpers.ts` uses `createBunDatabase` + migration replay. New core service tests should follow this pattern.

### Known transient hacks (remove when applicable)

### Drizzle-kit + manual migrations

If `drizzle-kit generate` auto-numbers a migration whose prefix collides with a manual migration not in `meta/_journal.json`, rename the generated SQL + snapshot to the next available index and add a matching journal entry. The journal advances monotonically; drizzle-kit's filename numbering is advisory. (We hit this with `0007_add_pulse_scope.sql` already on disk when generating `0008_pipelines.sql`.)

**Hand-written ALTER migrations don't generate paired snapshots.** When you add a column via a hand-written SQL migration (e.g. adding `window_ms` to `pipeline_analysis_template`), drizzle-kit doesn't auto-produce a paired entry in `meta/<n>_snapshot.json`. The migration still applies correctly at runtime since `_journal.json` is the source of truth — but the next time someone runs `drizzle-kit generate`, the snapshot may drift. Run `bunx drizzle-kit generate` after the next schema change to reconcile.

### Biome style for status enums

`packages/schema/src/database/schema.ts` uses single-line const arrays for status enums (e.g. `RUN_STATUSES`, `STAGE_EVENT_KINDS`). Don't break this style — biome's format rule enforces it.

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

### Workspace dep declarations under bun's isolated linker (CRITICAL)

Bun 1.3+ installs with an isolated linker by default: a package can only resolve dependencies it explicitly declares in its own `package.json`. Transitive resolution through the workspace root does NOT happen at build time for bare specifiers.

- `packages/core/src/ui/styles/globals.css` does `@import "@f0rbit/ui/styles"`, so `packages/core/package.json` MUST declare `@f0rbit/ui` as a dependency. Without it, `node_modules/.bun/.../packages/core/node_modules/@f0rbit/ui` is not created and Vite/PostCSS fails with `ENOENT: ... open '@f0rbit/ui/styles'`.
- `apps/blog/src/middleware.ts` and `apps/media/src/middleware.ts` import `@devpad/core/ui/middleware`, so both apps' `package.json` MUST declare `@devpad/core` as a workspace dep. Without it, Rollup fails with `failed to resolve import "@devpad/core/ui/middleware"`.
- Rule of thumb: if a file uses a bare specifier (`@scope/pkg/path`), the package owning that file must declare the dep — even when the dep is already available transitively elsewhere in the workspace.

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

### Lint/format wiring (scaffolder, `~/dev/lint` linting-strategy Phase 4)

Every package `devpad pipelines init` scaffolds ships `@f0rbit/lint` from birth: `.oxlintrc.json`, `.oxfmtrc.json`, `eslint.config.ts` (`snake_case` naming preset, matching the ecosystem-wide direction — flipped from `camelCase` in the fix/lint-gate PR, see below), and `bunfig.toml` (hoisted linker) are template entries in `SCAFFOLDER_TEMPLATES`; `package.json.hbs` pins `@f0rbit/lint` exact (currently `0.1.5`); `deploy.yml.hbs` runs `bun run lint && bun run fmt:check` before tests. Same hand-sync rule as above: this only affects packages scaffolded _after_ the change landed — pre-existing scaffolded packages need `f0rbit-lint init` run manually to adopt it. `src/index.ts`'s `WorkerEntrypoint` subclass needs a scoped `eslint.config.ts` override (`functional/no-classes` + `functional/no-this-expressions` off) since Cloudflare's Worker API is class-based with no functional-style escape hatch — the scaffolder template already carries this override, so hand-adopting packages should copy it rather than rediscovering it. The two scaffolded helper functions in `src/index.ts.hbs` (`read_caller_identity`, `emit_pulse`) are snake_case to match; the remaining camelCase identifiers you'll see in a fresh scaffold (`compatibilityDate`/`compatibilityFlags` on Alchemy's `Worker()` config, `extendTemplate`/`afterBake` from `@devpad/pipeline-templates`) are external library API surface, not renamable from the scaffold side.

### Lint/format wiring (devpad's OWN repo, `~/dev/lint` linting-strategy Phase 5+fix/lint-gate)

The wiring PR (Phase 5) added `@f0rbit/lint@0.1.3` at the workspace root as **wiring + survey only** — no reformatting, no violation fixes, no CI gate, `naming: "camelCase"`. The `fix/lint-gate` PR (final PR of the 3-PR rollout: wire → normalize → fix+gate) bumped to `@f0rbit/lint@0.1.5`, flipped `naming` to `"snake_case"` (the migration target — see the rule-tier table below), fixed the real violations, and wired the CI gate. Root scripts (unchanged shape): `lint` (`oxlint --ignore-pattern 'packages/cli/tests/golden/**' . && NODE_OPTIONS=--max-old-space-size=8192 eslint .`), `fmt` (`oxfmt .`), `fmt:check` (`oxfmt --check .`).

**`bun run lint` is now a required CI gate** (`.github/workflows/test.yml`'s `Lint` step, blocking — no `continue-on-error`) and a required status check on the `protect-main` branch ruleset (`context: "test"`, matching the `test` job).

**Rule-tier table** (current state, `eslint.config.ts`'s repo-wide override block):

| Tier                                           | Rules                                                                                                                  | Why                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `warn` (phased migration)                      | `@typescript-eslint/naming-convention`                                                                                 | camelCase → snake_case migration, phased. Follow-up: `task_77589418-c5e0-4f8f-8864-713d5199085f`                                                                                                                                                                                      |
| `warn` (phased migration)                      | `no-unsafe-{assignment,member-access,argument,call,return}`, `functional/no-this-expressions`, `functional/no-classes` | pre-toolchain debt in boundary typing + class-based providers (`packages/api`, `packages/pipeline-fakes`). Follow-up: `task_ed8646a5-97e8-41a8-b279-317fe5b210bd`                                                                                                                     |
| `warn` (phased migration)                      | `functional/no-throw-statements`, `functional/no-try-statements`                                                       | architectural migration to Result combinators, not mechanical — discovered at 327+243 baseline during the fix/lint-gate survey (the original wiring-PR top-5 list didn't anticipate this bucket). Follow-up: `task_90024e9a-6d3a-4ebc-8134-55ff2c5f3616`                              |
| `warn` (factory default, 0.2.0/0.3.0 rollout)  | `f0rbit/no-ambient-effects`                                                                                            | ships warn-tier from the factory — 236 baseline hits (`Date.now()`/`new Date()`/`Math.random()`). Graduates to error once packages designate clock/rng provider modules via `ambient_effect_files` (pulse phase-3 precedent). Follow-up: `task_20d205a2-5c6d-40a2-a9af-e47940a6dba2`  |
| `warn` (factory default, 0.2.0/0.3.0 rollout)  | `f0rbit/prefer-pipe`                                                                                                   | ships warn-tier from the factory — 15 baseline hits (2+ consecutive discarded-Result guards composable via `pipe()`). Manual per-site refactor, not mechanical. Follow-up: `task_093e3f71-2291-4f2e-99ce-2e8392793187`                                                                |
| `error` (fixed for real)                       | `f0rbit/must-use-result`                                                                                               | genuine discarded-Result bugs — every baseline violation (65) got a real fix in fix/lint-gate, no exceptions                                                                                                                                                                          |
| `error` (fixed for real, 0.2.0/0.3.0 rollout)  | `no-console`, `@typescript-eslint/consistent-type-definitions`, `f0rbit/require-schema-at-boundary`                    | new error-tier rules added crossing the 0.2.0 and 0.3.0 breaking-change waves (`@f0rbit/lint@0.1.5` → `0.3.0`, `chore/lint-030`) — every baseline violation fixed for real or narrowly overridden (see "Lint 0.3.0 rollout" section below for the full delta survey and override map) |
| `error` (fixed for real, or narrowly excepted) | everything else                                                                                                        | mechanical fixes (imports, casts, dead code, unsafe boundary narrowing where not covered above) — see the fix/lint-gate PR body for the before/after survey numbers                                                                                                                   |

Distribution was checked before tiering any rule (not just naming-convention): every warn-tier rule above hits 6+ top-level packages/apps roughly evenly (tests/, core, worker, cli, api, mcp, pipelines*, apps/*) — none was concentrated enough to scope narrower than repo-wide.

Excluded-from-typed-linting test directories are their own, separate follow-up (`task_48d3a037-66f5-4919-93fa-030b902eaea3`) — see the projectService coverage-gap list below, unchanged by fix/lint-gate.

- **`module_resolution: "bundler"`** (added in fix/lint-gate) fixes the false-positive bulk of `import-x/extensions`: devpad writes extensionless relative imports throughout (Vite/Astro apps, tsup-built packages) — the ecosystem bundler convention, not Node-ESM's "every relative import needs `.js`" rule. Two residual gaps the bundler resolver still can't cover, each with a narrow documented `eslint.config.ts` override: (1) `apps/{main,blog,media}/src/**` use the `@/*` tsconfig path alias, which `createNodeResolver` can't resolve at all (verified empirically — fails the rule both with and without an explicit extension); (2) `packages/mcp/src/index.ts` imports `@modelcontextprotocol/sdk`, which mandates a real `.js` extension in its own package exports map, and bundler mode's pattern applies "never" unconditionally even to bare package specifiers.
- **Coexists with biome, doesn't replace it yet.** biome remains the formatter/linter for `.astro` — `format`, `format:check`, `lint:fix` (biome, unchanged) still work exactly as before, including the "DO NOT RUN `bun lint:fix`, breaks astro imports" caution above. The OLD biome-backed `lint` script is `lint:biome`. Don't confuse the two: `bun run lint` is oxlint+eslint (the gate), `bun run lint:biome` is the pre-existing biome check (unaffected, still used for `.astro`). Full biome removal is tracked as `task_bbedd518-ebde-4172-be2f-a6b719ac1eba`.
- **`NODE_OPTIONS=--max-old-space-size=8192` is load-bearing, not decorative.** Node's default heap OOMs (`FATAL ERROR: Ineffective mark-compacts near heap limit`) running typed ESLint across this monorepo's ~13 separate tsconfig projects in one process. Don't strip it when touching the `lint` script.
- **oxlint auto-discovers nested `.oxlintrc.json` files during its directory walk, ignoring the root config's own `ignorePatterns` for that discovery step.** `packages/cli/tests/golden/*` each ship their own `.oxlintrc.json` (scaffolder output, phase 4) whose `extends` can't resolve (no `node_modules` installed in the fixture) — oxlint hard-crashes (`Failed to build configuration from .../golden/.../.oxlintrc.json`) unless given `--ignore-pattern 'packages/cli/tests/golden/**'` on the **command line**. This is distinct from the already-known "`ignorePatterns` don't propagate through `extends`" gotcha (corpus AGENTS.md) — here the config-file `ignorePatterns` field doesn't even stop the walk into the ignored directory for config-discovery purposes. If oxlint's alpha fixes this, the CLI flag becomes redundant but harmless.
- **typescript-eslint's `projectService` resolves the NEAREST ANCESTOR `tsconfig.json` by directory walk — a sibling config's `include` pattern reaching in via `../` is never discovered.** Learned the hard way: widening `tests/integration/tsconfig.json`'s `include` with `"../shared/**/*"` did NOT fix lint coverage for `tests/shared/*.ts` (still "not found by the project service") because `tests/shared/` isn't a descendant of `tests/integration/`. Fixed instead with a dedicated `tests/shared/tsconfig.json`. Don't repeat the mistake of trying to pull in an unrelated directory via a sibling's `include`.
- **Root `tsconfig.json` is new** (`devpad` previously had none). Two jobs: (a) it's the extends-target `packages/mcp/tsconfig.json` already declared (`"extends": "../../tsconfig.json"`) but which pointed at nothing — pre-existing dangling reference, invisible until now because `packages/mcp` has no `typecheck` script and its `build` uses `bun build` (not `tsc`), so nobody ever loaded that config; (b) it's the base + `types: ["bun"]` for typescript-eslint's default-project handling of `eslint.config.ts` and the three loose root scripts (`scripts/build-unified.ts`, `playwright.config.ts`, `playwright.staging.config.ts`), which are otherwise added to its `include`.
- **projectService coverage gaps found and their disposition:**
  - Fixed (cheap, one line, no `rootDir` conflict): `packages/mcp` (root tsconfig.json above), `packages/pipelines/infra.ts` (added to that package's own `include` — it has no `rootDir` set), `tests/integration` + `tests/shared` (new dedicated tsconfig, see above).
  - **Excluded, not fixed — tracked as `task_48d3a037-66f5-4919-93fa-030b902eaea3`**, via `ignores` in root `eslint.config.ts`: `packages/api/tests/**` (that package's own `tsconfig.json` excludes `"tests"` entirely AND sets `rootDir: "./src"`, so these files can't just be added to `include` without a dedicated test tsconfig); `packages/core/src/**/__tests__/**` (own tsconfig excludes `**/*.test.ts` — **the single biggest gap, ~35 files**, including the pipelines-domain suite under `packages/core/src/services/pipelines/__tests__/`); `tests/e2e/**` (Playwright specs/fixtures — no tsconfig exists for this directory, and it's a different test runner/type surface from `bun test`); `packages/api/tsup.config.ts` and `packages/schema/drizzle.config.ts` (single root-level config files that sit outside their package's `rootDir: "./src"` — adding them to `include` trips a `rootDir` violation, so they need either a dedicated config-file tsconfig or `rootDir` removed).
- **Removed a dead, actively-harmful `eslint` pin**: `packages/api/package.json` had `"eslint": "^8.57.0"` (devDependency) and a `"lint": "bun run eslint"` script with **no `.eslintrc`/`eslint.config.*` anywhere in the package** — already broken before the wiring PR (`ESLint couldn't find a configuration file`). Worse, under bun's hoisted linker it won the root `node_modules/.bin/eslint` symlink over `@f0rbit/lint`'s ESLint 9, so `bun run lint` at the root silently ran the wrong major version and errored the same way. Removed both; nothing else in the workspace pins `eslint` directly. If you see this failure mode again (`ESLint: 8.57.1` / "couldn't find a configuration file" when flat config exists), suspect a reintroduced legacy `eslint` devDependency winning the hoist.
- **`naming: "snake_case"` (flipped from `camelCase` in fix/lint-gate) — the codebase is genuinely mixed, now inverted.** `packages/core/src/services/pipelines/**` (grants, gates, analysis, runs — the platform-integration code) was already written in snake_case, matching corpus/pipelines-setup convention; that cluster is now the model, not the minority. The REST of the historical codebase (`packages/core/src/auth/**`, `apps/*/src/**`, etc.) is camelCase and is now the minority under the new preset — this inversion is exactly why naming-convention is warn-tier (phased migration, `task_77589418-c5e0-4f8f-8864-713d5199085f`), not something the fix/lint-gate PR bulk-renamed.
- **`unicorn/filename-case` (oxlint, kebab-case) — RESOLVED.** The ~72 PascalCase Solid/React component files (`apps/{main,blog,media}/src/components/**/*.tsx`) plus one camelCase hook file were renamed to kebab-case in fix/lint-gate via `git mv` (case-insensitive-filesystem-safe, verified via `git ls-files`), with every import site updated. No filename-case exceptions remain.
- **Astro pages (`apps/{main,blog,media}/src/**/_.astro`) are out of scope** — oxlint/typescript-eslint don't parse `.astro`. The `ts_files`glob naturally excludes them (ESLint flat config only applies rules to matched`files:`), but an explicit `ignores: ["\*\*/_.astro"]` entry documents the boundary rather than relying on that being silent. They stay on biome's formatter/linter until upstream Astro support exists.
- **oxfmt's reach is broader than JS/TS** — it also reformats `.md`, `.yml`, `.json`, `.jsonc`, `.toml` by default. `wrangler.toml` and `packages/pipelines/wrangler.jsonc` are excluded via `.prettierignore` (same care-note as the pulse rollout: hand-placed comments and deploy semantics must survive).
- **Golden fixtures** (`packages/cli/tests/golden/**`, scaffolder output snapshots asserted byte-for-byte) and the **scaffolder template stubs** (`packages/pipeline-templates/src/scaffolder/templates/**`, mostly `*.hbs` so already extension-excluded) are excluded from all three tools. The golden fixtures DO get regenerated (`UPDATE_GOLDENS=1 bun test scaffold-init-golden`) whenever a template stub itself changes (e.g. the naming-preset flip, the version bump) — that's expected drift, not a toolchain violation.
- **Baseline violation survey, wiring PR** (`bun run lint`, `bun run fmt:check`): oxlint 973 diagnostics / 493 files; eslint (typed layer) 6774 problems, top rules `@typescript-eslint/naming-convention` (2089, under the OLD camelCase preset), `@typescript-eslint/no-unsafe-member-access` (759), `@typescript-eslint/no-unsafe-assignment` (554), `functional/no-this-expressions` (435), `f0rbit/must-use-result` (65); oxfmt flags 362/533 files as unformatted. No CI gate.
- **Post-bump/post-flip survey, fix/lint-gate PR** (after `@f0rbit/lint@0.1.5` + `naming: "snake_case"`, before any fixes): oxlint 971 (naming-preset-independent, as expected — oxlint doesn't run the typed naming-convention rule); eslint 6850 errors / 0 warnings (naming-convention alone jumped to 2502 under the new preset, confirming the inversion above).
- **Final state, fix/lint-gate PR merged**: `oxlint .` — 0 diagnostics. `bun run lint` (eslint) — 0 errors, 4690 warnings, all on the tiered families: `naming-convention` 2534, `functional/no-this-expressions` 435, `no-unsafe-member-access` 427, `no-unsafe-assignment` 354, `functional/no-throw-statements` 336, `functional/no-try-statements` 245, `no-unsafe-call` 198, `no-unsafe-argument` 99, `functional/no-classes` 33, `no-unsafe-return` 29. `f0rbit/must-use-result` — 0 (all 65 baseline violations fixed for real; see the fix/lint-gate PR body for the per-package fix scorecard). `bun run fmt:check` — clean. The mechanical/must-fix bucket (import extensions, casts, dead-code triage, no-unnecessary-condition, restrict-template-expressions, no-confusing-void-expression, no-misused-promises, no-floating-promises, etc.) went from ~1250 to 0 across the whole repo.
- **Fixing `@typescript-eslint/no-unnecessary-condition` on a `.default(...)` Zod field: fix the caller, not the service.** A Zod schema field with `.default(x)` makes the OUTPUT type (what `z.infer` gives you) non-optional, so a service function typed against that inferred type will correctly get `no-unnecessary-condition` on any `?? x` fallback — but only if every real caller actually runs the value through `Schema.parse()` first (worker routes via `zValidator`, MCP tools via the schema-typed tool definitions both do). Hand-constructed test fixtures that build the call object directly, bypassing `.parse()`, are the ones papering over a real gap with `??` — fix the fixture to supply the field, not the service to re-add a default that duplicates the schema's own single source of truth. Got this backwards once during the fix/lint-gate pass (`packages/core/src/services/blog/{posts,categories}.ts`) before catching it via `bun run test:unit` + a second `bun run lint` pass — restoring `??` in the service reintroduced the exact error it was meant to fix, because the service file (unlike its `__tests__` sibling) IS typed-linted.
- **`authMiddleware`'s API-key path requires a non-null `user.github_id`/`user.name`** (`packages/worker/src/middleware/auth.ts`), mirroring the session-auth path's pre-existing identical check — every real devpad user signs up via GitHub OAuth and always has both. A test fixture creating a user with `github_id: null` (as `tests/shared/test-utils.ts`'s `createTestUser` once did) silently fails every API-key-authenticated integration test with a 401 "Invalid or expired API key", since the two non-null assertions this check replaced (`no-non-null-assertion` fix) used to tolerate exactly this case. If integration tests start failing with that message repo-wide, check this first before suspecting the auth stack itself.
- **Renaming a private class field (`no-underscore-dangle` fixes etc.) must also grep for bracket-notation string-literal access** (`obj["_old_name"]`), not just `.{old_name}` dot-access and import references. TypeScript does NOT flag `obj["_old_name"]` as an error when `_old_name` isn't a real member on a plain class (no index signature) — it silently types the expression `any` instead of erroring, so a stale string literal survives a rename with zero compiler signal. `tests/integration/milestones-goals.test.ts` reached into `ApiClient`'s private field this way to build its own `Authorization` header for raw `fetch()` calls; the `_api_key` → `api_key_field` rename (mechanical oxlint fix) broke it silently until the integration suite caught it.
- **`bunfig.toml`'s `linker = "hoisted"` makes the root `overrides`/`devDependencies` versions apply repo-wide — a stray root pin now has real teeth.** Before this PR, bun's default isolated linker let each workspace package's own `devDependency` range win for its own build even when the root declared something else (packages nested their own copy). Under hoisted, only ONE copy of a package can live at the true root `node_modules/<pkg>`, and tools that are THEMSELVES hoisted at root (like `tsup`, used by `packages/api`'s build) resolve dependencies like `typescript` starting from their OWN location — so they get whatever's hoisted at root, not whatever a workspace package nested for itself, even though bun still nests a per-package copy when versions conflict. This bit us for real: a `"typescript": "^6.0.3"` root devDependency (present since May 2026, inert under isolated) suddenly forced `packages/api`'s `tsup` DTS build onto TS 6, which hard-errors (`TS5101`) on `baseUrl` in `packages/api/tsconfig.json` — broke `main` for several hours (PR #126 merged with this pre-existing landmine + the newly-real hoisting in the same commit; fixed by removing the stray root pin, letting bun resolve the single compatible 5.x version every package's own range already agreed on). **Whenever touching `overrides`, root `devDependencies` versions, or `bunfig.toml`'s linker setting, run `bun install` fresh and check `cat node_modules/typescript/package.json` (or whatever package you touched) resolves to what every workspace package's own range expects — don't assume hoisting is a no-op just because each package still declares its own range.**

### Lint 0.3.0 rollout (`~/dev/lint` linting-strategy Phase 3 wave, `chore/lint-030`)

Bumped `@f0rbit/lint` `0.1.5` → `0.3.0`, crossing both the 0.2.0 wave (`no-test-mocks`, `no-console`, `consistent-type-definitions` flip to error) and the 0.3.0 wave (`f0rbit/require-schema-at-boundary` flips to error; `f0rbit/no-ambient-effects` + `f0rbit/prefer-pipe` ship warn-tier by factory default). `no-test-mocks` and `f0rbit/must-use-result` baselined at 0 (confirmed no regressions — devpad already has zero `bun:test` mock usage). Post-bump baseline: 631 new errors (`no-console` 291, `f0rbit/require-schema-at-boundary` 199, `@typescript-eslint/consistent-type-definitions` 141) + 251 new warn-tier hits (`f0rbit/no-ambient-effects` 236, `f0rbit/prefer-pipe` 15, left as-is per the rule-tier table above — new graduation follow-ups `task_20d205a2-5c6d-40a2-a9af-e47940a6dba2` and `task_093e3f71-2291-4f2e-99ce-2e8392793187`). Final state: `bun run lint` 0 errors, pre-existing warn-tier counts unchanged (naming-convention/unsafe-\*/throw-try families untouched by this rollout).

- **`consistent-type-definitions` (141 → 0): pure autofix.** `eslint . --fix` mechanically rewrote 138 `interface` declarations to `type` aliases across 75 files (apps + packages) with a byte-for-byte-balanced diff (138 insertions / 138 deletions, no incidental churn). The only manual carve-out: **`**/env.d.ts` gets a scoped override** (`"@typescript-eslint/consistent-type-definitions": "off"`) — all three apps' `env.d.ts`declare`interface`inside (or, for`apps/main`, structurally equivalent to) `declare global { namespace App { interface Locals } } }`/`interface ImportMetaEnv`, and typescript-eslint's own autofix returns `null`on ambient merged declarations (upstream #2707) rather than risk breaking Astro's`Locals` declaration-merging contract.
- **`no-console` (291 → 0): three dispositions — override, migrate, delete.**
  - **CLI output, scoped to actual output modules** (not the whole package): `packages/cli/src/{index.ts,printer.ts,corpus-http-backend.ts,commands/pipelines.ts}` — genuine terminal UX (progress spinners, command output). `asset-walker.ts`/`bundle-walker.ts`/`corpus-backend.ts`/`pipelines-artifacts-helpers.ts` had zero console calls and got no override. A second override covers `packages/cli/tests/**` (console-capture monkey-patching in 2 test files for output assertions, plus golden-regen/test-debug prints).
  - **Migrated to the sanctioned structured-logging channel** where one existed: `packages/core/src/services/pipelines/{grants.ts,gates/analysis.ts}` now use `createLogger` (`packages/core/src/utils/logger.ts`, already the pattern for ~19 media-sync files) instead of calling `console.*` directly — that wrapper itself gets the one legitimate `no-console: off` override. `packages/worker/src/routes/auth.ts`'s 5 debug `console.log` calls migrated to `c.get("log")?.debug(...)` (the Hono-context pulse logger, already used one line above for `login_success`). `packages/worker/src/index.ts`'s `onError` handler migrated its `console.error` to `c.get("log")?.error(...)`.
  - **`apps/main/src/lib/pulse.ts`'s browser `log` namespace was exported but had ZERO real consumers anywhere in the app** (only `track` was used, despite the module's own docstring documenting `log.error`/`log.warning`) — this rollout is the first real adoption: `update-diff.tsx`, `tag-editor.tsx`, `task-status.ts`, `task-sorter.tsx`, `task-editor.tsx`, `config-editor.tsx`, `task-card.tsx`, `goal-selector.tsx`, `goal-quick-form.tsx` now report real errors to pulse instead of swallowing them in `console.error`. `apps/blog` and `apps/media` have no equivalent client-side pulse wiring yet, so their handful of `console.error("[Component] ...")` catch-block logs (plus `apps/media`'s `ErrorLogFn` default implementation in `error-logger.ts`) stay as scoped overrides until one gets built — tracked as a natural follow-up, not filed as a separate task (low volume, do it if/when touching those apps again).
  - **Deleted as genuinely dead code**: `packages/core/src/utils/client-logger.ts` (the `./logger` package.json export) — zero real importers anywhere in the workspace (only exported, never consumed; all its `CLIENT_DEBUG_LOGS` flags were hardcoded `false`). Removed the file and its `package.json` exports entry rather than fix/override it, per this repo's "delete old code" convention. Also deleted ~7 lines of leftover step-by-step debug tracing (`[resolveAuth] ...`, `[worker] ...`) in `packages/worker/src/index.ts` that had no test coverage and no production value beyond what the pulse-based error capture already provides.
  - **Permanent, non-debt exceptions** (scoped overrides with why-comments, not migrated): `packages/mcp/src/index.ts` (stdio MCP server — `console.error` is the only legitimate stderr channel since stdout carries JSON-RPC framing), `packages/schema/src/errors.ts`'s `defaultLogger` (the pluggable `ErrorLogFn`'s built-in console-based implementation — consumers override via `configureErrorLogging` when they have a real channel), `packages/api/src/request.ts` (`ApiClient`'s own opt-in `debug` constructor flag, not unconditional logging), `packages/worker/src/{index.ts,local.ts}` (one remaining `console.error` each — an Astro-handler-crash fallback outside any Hono request context, and a bun-native local-dev bootstrap fatal-config check), `scripts/build-unified.ts` (build-script terminal progress output, same class as the CLI), and `tests/integration/**` + `tests/shared/test-utils.ts` (pre-existing "soft-skip" integration-test pattern — `console.warn` a diagnostic and return early when a route isn't implemented yet in the local test server, instead of hard-failing; not migrated, to avoid changing which soft-skips are visible in default CI output).
- **`f0rbit/require-schema-at-boundary` (199 → 0): the rule's real AST mechanics matter more than its docs suggest — see the gotcha below before touching this rule again.**
  - **Bucket 1 (reuse or write a real Zod schema)**: `packages/core/src/services/media/platforms/bluesky.ts` (existing `BlueskyRawSchema`, just fixed the intermediate `as Record<string, unknown>` cast blocking it), `packages/core/src/services/scanner/github.ts` (new `TreeResponseSchema`/`ContentResponseSchema` for GitHub's tree + contents APIs), `packages/core/src/auth/oauth.ts` (new `GitHubTokenResponseSchema`/`GitHubUserResponseSchema`/`GitHubEmailsResponseSchema`/`DecodedOAuthStateSchema` — GitHub OAuth token exchange + user + emails + devpad's own CSRF state), `packages/core/src/auth/jwt-web.ts` (new `JWTPayloadSchema` — devpad's own session JWT, defense-in-depth on top of the HMAC signature check), `packages/schema/src/bindings.ts` (`AuthUser` converted to `AuthUserSchema` + `z.infer` — single source of truth instead of a hand-written type; consumed by `packages/core/src/ui/middleware.ts`'s `X-Auth-User` header parse and a new local `SessionCheckResponseSchema`), `packages/worker/src/routes/v1/media/auth.ts` (new `RedditUserResponseSchema`/`TwitterUserResponseSchema`/`GitHubUserResponseSchema` for the media-platform OAuth `fetchUser` callbacks), `packages/worker/src/routes/v1/media/credentials.ts` (new `RedditTokenResponseSchema`), `apps/main/src/utils/project-context.ts` (new `ProjectContextSchema` for the app's own `sessionStorage` round-trip), and the scaffolder template's `e2e/health.spec.ts.hbs` (new local `HealthResponseSchema`/`VersionResponseSchema` — a real network call to the deployed worker, not a deep-clone or internal read).
  - **Bucket 2 (genuinely internal — no real boundary crossed)**: DB JSON columns the app wrote itself (`credentials.ts`'s `metadata`, `projects.ts`'s tag `matches`, `scanning.ts`'s `todo_updates.data`), CLI build-artifact/local-file reads (`commands/pipelines.ts`'s manifest/payload-file/script-name-overrides, `pipelines-artifacts-helpers.ts`), internal service-to-service pass-through (pipelines providers' `cf-api-provider.ts`/`corpus-providers.ts`/`pulse.ts`, `routes.ts`'s DO-forwarding, `run-do.ts`, worker's `pulse.ts`/`pipelines-dashboard.ts`/`oauth-helpers.ts` proxies), devpad's own nav-history cookie and pipeline-run JSON columns in `apps/main` (`middleware.ts`, `run-progress.tsx`, `stage-gate.tsx`), `apps/media`'s own API + `localStorage` (`profile-editor.tsx`, `error-logger.ts`), and generic client/error-parsing code with no fixed shape (`packages/api/src/{request.ts,error-handlers.ts}`, `scripts/build-unified.ts`). Fixed via the `const x: unknown = <boundary call>; ... x as T` escape hatch (see gotcha below) — no schemas written for these, per the "don't gold-plate a one-off internal read" guidance.
  - **Deep-clone carve-out**: `apps/main/src/components/solid/update-diff.tsx`'s `JSON.parse(JSON.stringify(items)) as UpdateData[]` → `structuredClone(items)` — exactly the case the rule's own error message hints at ("use `structuredClone(...)` if this is only a deep clone").
  - **Test files** (`tests/integration/**`, `packages/{pipelines,worker,cli}/**/__tests__/**`, ~131 hits across 24 files): fixed via the same `unknown`-annotation escape hatch as bucket 2 — ad-hoc inline response-shape assertions in test code don't warrant new Zod schemas. A few files reused an already-declared local type/helper instead of the bare-`unknown` default where one already existed in the same file: `tests/integration/mcp-server.test.ts` (new `extractMCPResponse()` helper, mirroring an identical pattern already in `mcp-extended-tools.test.ts`), `tests/integration/milestones-goals.test.ts` (cast to the already-imported `Milestone`/`Goal` types), `packages/pipelines/__tests__/integration/analysis-template-routes.test.ts` (the file's own `Envelope` type). `packages/cli/tests/unit/compile-template.test.ts` tried casting to the real `PipelineTemplate` type but reverted to the bare-`unknown` escape hatch because `.rollout` is a discriminated union the test accesses without narrowing.
- **`require-schema-at-boundary` gotcha — the "sanctioned unknown" escape hatch is stricter than it sounds; read the rule source before assuming a fix works.** Confirmed empirically (dozens of iterations) against `/Users/tom/dev/lint/packages/eslint-plugin/src/rules/require-schema-at-boundary.ts`:
  - **`const x: unknown = JSON.parse(...)` works. `JSON.parse(...) as unknown` does NOT**, even though both produce an `unknown`-typed value. The rule only recognizes an explicit `: unknown` type annotation on the variable **declarator** itself as "sanctioned, stop tracking forever" — a cast on the initializer expression doesn't count, because the rule's `classify_declarator` check reads `declarator.id.typeAnnotation`, not the initializer's type.
  - **`(x as unknown) as T` (a peel-through cast) is STILL flagged** — the rule explicitly peels `as unknown` layers looking for the real consuming context and reports the OUTER cast as `cast_boundary`. There is no double-cast escape.
  - **Chaining `.then()`/`.catch()` directly onto `.json()` breaks sink detection** (`response.json().then(x => Schema.parse(x))`, `response.json().catch(() => null)`) — the `.json()` call's immediate AST parent becomes a `.then`/`.catch` `MemberExpression`, which the rule never recognizes as a sanctioned shape, regardless of what happens further down the chain. Fix: `await`-then-parse in the same expression (`Schema.parse(await response.json())`), or wrap in a real `try`/`catch` statement instead of promise chaining.
  - **A bare `x = JSON.parse(...)` reassignment to an already-declared variable is ALSO flagged**, even when `x` was pre-declared `let x: unknown;` — a plain `AssignmentExpression` is never a recognized consuming shape, regardless of the target's declared type. Fix: parse into a **fresh** `const`-declared, explicitly-`unknown`-annotated variable inside the block, then assign that variable's value to the outer one (`const parsed: unknown = JSON.parse(t); x = parsed;` — the second line is a plain identifier assignment, invisible to the rule).
  - **A `JSON.parse(...)` call nested inside a ternary is never sanctioned no matter what wraps the ternary** (`cond ? JSON.parse(x) : null` as a declarator initializer) — the rule only inspects ONE level of parent AST context, and `ConditionalExpression` isn't a recognized shape. Lift the call out into its own `if`/`else` first.
  - **Rebuild `packages/schema` (or whichever package you added a Zod schema to) before re-linting consumers** — the type-aware `is_zod_receiver` check resolves imports through `dist/*.d.ts` (per the package's `exports` map), not the `src/*.ts` you just edited. A schema added to source but not rebuilt shows up as `@typescript-eslint/no-unsafe-call`/`no-unsafe-member-access` ("type cannot be resolved") on the `.parse()` call, not as a boundary-rule pass — easy to misdiagnose as the schema not being recognized as a Zod type when it's actually just stale dist types.
- **New graduation follow-ups** (same v1 mechanism — devpad tasks + this table + the `eslint.config.ts` comment block, NOT a new list): `task_20d205a2-5c6d-40a2-a9af-e47940a6dba2` (`f0rbit/no-ambient-effects`, 236 hits, needs clock/rng provider modules before graduating), `task_093e3f71-2291-4f2e-99ce-2e8392793187` (`f0rbit/prefer-pipe`, 15 hits, needs manual `pipe()` refactors).
- **Scaffolder template updates** (`packages/pipeline-templates/src/scaffolder/templates/`, 4 deliberate edits, no incidental churn): `package.json.hbs`'s `@f0rbit/lint` pin `0.1.5` → `0.3.0`; `src/env.ts.hbs`'s `AnthropicVaultBinding` `interface` → `type` (mechanical, matches what `--fix` would do — templates are excluded from devpad's own autofix run so this was hand-applied); `eslint.config.ts.hbs`'s existing `src/index.ts` override gained `"no-console": "off"` for `emit_pulse`'s two fire-and-forget `console.error` calls (the fallback for when pulse itself, the only observability channel, is unreachable); `e2e/health.spec.ts.hbs`'s two `(await response.json()) as {...}` casts became real `z.object(...).parse(...)` calls (a genuine external network boundary — the deployed worker's `/health` and `/version` endpoints). Golden fixtures regenerated (`UPDATE_GOLDENS=1 bun test scaffold-init-golden`) — the diff touches exactly these 4 changes across all 4 golden combos, nothing else. **`packages/cli/tests/integration/scaffold-init-golden.test.ts`'s hand-rolled `tsconfig.json`/`types-stub.d.ts` generator (used because the golden test's scaffolded package has no real `node_modules`) needed a `zod` path-stub + ambient module declaration added** — the e2e spec template didn't import any third-party package before this change, so `zod` wasn't in the stub list; any future template change that adds a NEW bare-specifier import needs the same stub-list update or the golden test's `tsc -p tsconfig.json` step fails with `TS2307`.

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

## E2E Harness (pipelines-e2e plan, Phase 0–3)

- **Local E2E is TWO servers, not one.** The Astro frontend (`apps/main` / `@devpad/app`) serves PAGES on `:3000` (`astro.config.mjs`) and its Vite proxy forwards `/api` + `/health` to the worker on `:3001`. The worker (`packages/worker`, `bun run dev`) serves ONLY `/api/v1` + `/health` and 404s page routes. Playwright's local `webServer` is a TWO-element array booting both; `baseURL` is `http://localhost:3000`. The unified SSR+API server (`createUnifiedWorker`) is a BUILD artifact (`dist/_worker.js`), NOT wired into `bun run dev` — do not assume `:3001` serves pages.
- **E2E is NOT in CI** (`.github/workflows/test.yml` runs only `test:unit` + `test:integration`). Commit `2255cb5` deleted `packages/server` (which served SSR pages on `:3001`) and repointed Playwright's `webServer` at the API-only worker without restoring page-serving, silently breaking the entire page-level suite until caught later. Any change to the dev-server topology or the page-serving path MUST be validated against the E2E suite manually until E2E is a CI check.
- **Fake auth lives in the ASTRO middleware** (`apps/main/src/middleware.ts`), gated on `NODE_ENV === "test"` OR `TEST_MODE === "enabled"` — so the Astro `webServer` MUST set `NODE_ENV=test` in its `env`, else every page redirects to login. Inject `X-Test-User: true` via `context.route()` (see `tests/e2e/pulse.spec.ts` / `pipelines-smoke.spec.ts` `inject_test_user`). The middleware resolves the fake user to id `"test-user-e2e"` — seed fixture data owned by that id. The worker ALSO does a real `validateSession` DB lookup on the forwarded `Cookie: auth_session=test-session`, so the seed must include a matching `session` row.
- **The seed cannot run via Playwright `globalSetup`.** The seed uses `bun:sqlite`; Playwright's bin is node-shebang and throws `Received protocol 'bun:'` when a node-side `globalSetup` imports it. Instead `e2e:local` runs `bun run tests/e2e/seed.ts` (standalone bun entrypoint) BEFORE `playwright test`. Fixture ids live in a node-safe module `tests/e2e/fixtures/pipeline-ids.ts` (NO runtime imports) so specs import ids without pulling `bun:sqlite` into node; the bun fixture `tests/e2e/fixtures/pipelines.ts` re-exports them (single source of truth). Seed is idempotent (delete-then-insert on fixed ids); it targets repo-root `database/test.db` (NOT `tests/database/test.db`) and closes its SQLite handle before exit.
- **The local worker mounts ONLY `/api/v1/pipelines/dashboard`.** The orchestrator routes (`/runs`, `/runs/:id/approve`, `/analysis-templates`, `/runs/:id/events`, `/grants`, `/pipelines/packages`) live in the separately-deployed orchestrator singleton and 404 locally. E2E specs needing those must assert the unreachable/empty/render-only path, not the round-trip. Because `packages.list()` 404s locally, the pipeline page is ALWAYS in its degraded state under the local harness.
- **The pipeline page degrades gracefully when the package service is unreachable — it does NOT 404.** `apps/main/src/pages/project/[project_id]/pipeline.astro` renders the tabbed shell + a `data-testid="pipeline-degraded"` banner when `client.pipelines.packages.list()` returns a non-ok Result. The dashboard fetch is keyed by _project_ (not package) and lives outside the `if (pkg)` block, so the dashboard tab still renders under degradation. Three distinct states: degraded (banner + shell), legitimate empty (`pipeline-empty`, packages.list ok with zero rows), happy (shell with package data). Assert `pipeline-degraded` for the local render proof.
- **Seed fixtures via the schema's drizzle helpers, never raw SQL.** Use `@devpad/schema/database/bun` (`createBunDatabase` / `migrateBunDatabase`) and the schema table exports, mirroring `packages/pipelines/__tests__/integration/helpers.ts` and `seed_baseline`. Schema drift then surfaces as a compile error in the fixture, not a runtime 500.
- **Dashboard-fixture run timestamps MUST be window-relative, not fixed dates** (pipelines-e2e Phase 2). The dashboard aggregator (`packages/core/src/services/pipelines/dashboard.ts`) filters runs by `started_at >= now - window_ms`, and the smallest selectable UI window is 24h. A fixed calendar `started_at` (the fixture originally used `2026-05-16`) falls outside every window as wall-clock advances, so the dashboard reports 0 runs and any "assert N runs" spec becomes hollow/red. `tests/e2e/fixtures/pipelines.ts` now anchors run timestamps ~2h before seed-time (`Date.now() - 2h`); counts stay deterministic (total=2, completed=1) because both runs land inside the default window. Keep new run fixtures window-relative.
- **The run-detail page hard-404s under the local harness — it does NOT degrade** (pipelines-e2e Phase 2). `apps/main/src/pages/project/[project_id]/pipeline/runs/[run_id].astro` calls `client.pipelines.packages.list()` and `rethrow()`s on a non-ok Result (unlike `pipeline.astro`, which degrades). Since `packages.list()` 404s locally, the whole run-detail page returns a 4xx. So `StageGate` / `RunProgress` / `StageEventTimeline` render-or-wiring is NOT observable locally — that needs the orchestrator stood up (out-of-scope). E2E specs assert the page returns a clean 4xx (not a 5xx/crash), not that the run-detail widgets mount.
- **Pulse-unreachable on the dashboard is the local DEFAULT, not something to mock.** The aggregator's `try_pulse_summary` only fetches pulse when both `pulse_api_base` and `pulse_internal_key` are configured; locally neither is set, so it returns `pulse: null` with NO outbound request. A `context.route()`/`route.abort()` matcher targeting a pulse URL is a no-op false-green locally. Assert the dashboard renders its counts with `pulse: null` directly.
- **Pipelines E2E runs in CI as a NON-BLOCKING `e2e` job** (pipelines-e2e Phase 3). `.github/workflows/test.yml` has a dedicated `e2e` job, structurally separate from the required `test` job (which remains the SOLE required gate). It runs `bun run e2e:ci`, installs Chromium via `bunx playwright install --with-deps chromium`, and uploads the Playwright HTML report (`.playwright/playwright-report`) as an artifact `if: failure()`. It is intentionally NOT in branch protection / required status checks — a red `e2e` does not gate merges. **Promote `e2e` to a required check only once observed stable across several runs.** Don't add `continue-on-error` (it would mask the job's own red status; non-membership in required checks is what makes it non-blocking).
- **`e2e:ci` runs the green, meaningful specs ONLY** (pipelines-e2e Phase 3): `pipelines-smoke`, `pipelines-dashboard`, `pipelines-render`, `pipelines-degraded`, `pages`. It EXCLUDES `happy-path.spec.ts` + `pulse.spec.ts`, which are pre-existing failures unrelated to pipelines — `/project/create` renders no `#project_id` field under local fake auth (separate project-create rot, tracked as a follow-up). Including them would make the CI job perpetually red and destroy its value as a signal. Fix those specs first before adding them to `e2e:ci`. `e2e:ci` mirrors `e2e:local` (seed under bun, then Playwright's `webServer` boots both servers); `NODE_ENV=test` for fake auth comes from `playwright.config` webServer env (not the shell), and the worker's `DATABASE_FILE=../../database/test.db` is wired into its webServer command — both resolve identically in CI.
- **`astro check` on `apps/main` has 3 pre-existing errors** unrelated to the pipelines work (`OptimisticTaskProgress.tsx` ts(2353), `Layout.astro` ts(2882) `@devpad/core/ui/styles`, `pipeline/runs/[run_id].astro` ts(2578) unused `@ts-expect-error`). Don't be alarmed by a non-zero exit; diff the error COUNT against baseline to tell whether your change regressed anything. Biome flags `.astro` frontmatter consts as "unused" (it can't see template usage) — these are false-positive warnings, not errors.

# Debugging

When running integration tests, logs will get piped to `packages/worker/server.log`, only read the logs if you're looking for errors.

In the case where you want logs in stdout, specify the exact test suite you want to run in the command using bun specifically rather than `make integration` & pass `DEBUG_LOGGING="true"` as an env variable to the function.
