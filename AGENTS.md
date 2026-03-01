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

## CSS Token Architecture
- `@f0rbit/ui` is the source of truth for design tokens (all 3 apps import `@devpad/core/ui/styles` which `@import`s `@f0rbit/ui/styles`)
- Apps no longer import `@f0rbit/ui/styles` directly -- it's included via `globals.css` in `@devpad/core/ui/styles`
- App-specific tokens that DON'T come from `@f0rbit/ui`: `--text-link`, `--hover-filter`, `--input-placeholder`, `--input-focus`, `--item-red`, `--item-green`, `--item-red-border`, `--item-green-border`
- When writing new CSS, use `@f0rbit/ui` token names (`--fg`, `--bg`, `--accent`, `--border`, `--bg-alt`, `--fg-muted`, `--fg-subtle`, `--fg-faint`, etc.)
- NEVER use legacy token names (`--bg-primary`, `--text-primary`, `--text-secondary`, `--input-background`, `--input-border`) -- they have been fully removed from the codebase (no `:root` aliases, no inline style consumers)

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

### Milestone/Goal Ownership
- Milestone and goal tables use `entity()` not `owned_entity()` — no `owner_id` column
- Ownership is checked via the parent project
- Provenance columns (`created_by`, `modified_by`, `protected`) still apply via `provenance()` in `entity()`

# Debugging
When running integration tests, logs will get piped to `packages/worker/server.log`, only read the logs if you're looking for errors.

In the case where you want logs in stdout, specify the exact test suite you want to run in the command using bun specifically rather than `make integration` & pass `DEBUG_LOGGING="true"` as an env variable to the function.
