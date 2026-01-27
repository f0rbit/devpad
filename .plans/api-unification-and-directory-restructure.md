# API Unification & Directory Restructure Plan

## Executive Summary

Two changes: (A) Move Astro frontends from `packages/` to `apps/`, and (B) unify the blog and media API layers into the existing worker/core patterns. Part A is mechanical and low-risk. Part B requires surgical precision — the blog-server is ~1,260 lines across 23 files and the media-server is ~3,300 lines across 57 files. Rather than forcing everything into `packages/core/src/services/`, we keep domain-specific packages but kill the duplicated auth, context, middleware, and route-helper layers.

### Key Architectural Decision (needs approval)

**Keep blog-server and media-server as packages, but gut them.**

Rationale for NOT dissolving them entirely into core:
1. **Blog services need a `corpus` dependency** — they're not pure `(db, ...) => Result` functions. The blog `PostService` needs `{db, corpus}` as deps. Forcing corpus awareness into core would pollute it.
2. **Media services need an `AppContext` with `backend`, `providerFactory`, `encryptionKey`, and `env` credentials** — these are genuinely different from devpad's `(db, user_id)` pattern. The media domain has encryption, platform providers, cron processors, timeline generation, and OAuth token management. These are complex subsystems.
3. **Media-server has 57 source files** including platform providers, cron processors, timeline generation, storage layers, merge logic, rate limiting, and sync utilities. Moving all of this into core would make core bloated and unfocused.

**What we DO unify:**
- Auth middleware → single implementation in `packages/worker/src/middleware/auth.ts`
- Route mounting → all routes mount in worker, blog/media export Hono sub-apps without their own middleware stacks
- Context types → single `AppContext` in worker bindings, blog/media get their domain context from it
- Response helpers → shared pattern for `Result<T, E> → HTTP response`
- Error types → blog adopts core's `ServiceError` shape (kind-based), media already uses schema-level errors

**What stays domain-specific:**
- Blog services stay in `packages/blog-server/src/services/` (they need corpus)
- Media services stay in `packages/media-server/src/services/` (they need AppContext with backend, providers, encryption)
- Media platforms, cron, timeline, storage stay where they are
- Blog corpus layer stays where it is

---

## Part A: Directory Restructure

### Changes

| From | To | Notes |
|------|-----|-------|
| `packages/app/` | `apps/main/` | devpad frontend |
| `packages/blog-app/` | `apps/blog/` | blog frontend |
| `packages/media-app/` | `apps/media/` | media frontend |

### Files that need updating

#### 1. Root `package.json` — workspaces
```json
// Before
"workspaces": ["packages/*"]

// After
"workspaces": ["packages/*", "apps/*"]
```

#### 2. Root `package.json` — scripts
```
"dev": "... --filter=@devpad/app dev"  → no change (filter uses package name, not path)
"dev:server": "DATABASE_FILE=../../database/local.db ..."  → no change (runs from packages/server)
```
The `--filter` commands use npm package names, not directory paths. They'll resolve correctly after `bun install` regenerates the lockfile.

#### 3. `scripts/build-unified.ts` — app directory paths
```typescript
// Before
const APPS = {
  devpad: { dir: join(ROOT_DIR, "packages/app"), filter: "@devpad/app" },
  blog: { dir: join(ROOT_DIR, "packages/blog-app"), filter: "@devpad/blog-app" },
  media: { dir: join(ROOT_DIR, "packages/media-app"), filter: "@media-timeline/website" },
};

// After
const APPS = {
  devpad: { dir: join(ROOT_DIR, "apps/main"), filter: "@devpad/app" },
  blog: { dir: join(ROOT_DIR, "apps/blog"), filter: "@devpad/blog-app" },
  media: { dir: join(ROOT_DIR, "apps/media"), filter: "@devpad/media-app" },
};
```
Note: `@media-timeline/website` should also be renamed to `@devpad/media-app` in its package.json if it hasn't been already.

#### 4. `packages/server/src/server.ts` — SSR handler import
```typescript
// Before
import { handler as ssrHandler } from "../../app/dist/server/entry.mjs";

// After  
import { handler as ssrHandler } from "../../../apps/main/dist/server/entry.mjs";
```

#### 5. `packages/server/src/local.ts` — static path
```typescript
// Before
staticPath: "../app/dist/client",

// After
staticPath: "../../apps/main/dist/client",
```

#### 6. Deployment files
All files in `deployment/` that reference `packages/app/dist/client`:
- `deployment/Dockerfile` — `WORKDIR /app/packages/app` → `WORKDIR /app/apps/main` and `STATIC_FILES_PATH=./apps/main/dist/client`
- `deployment/production.ts` — `staticPath: "./packages/app/dist/client"` → `"./apps/main/dist/client"`
- `deployment/docker-compose*.yml` (4 files) — `STATIC_FILES_PATH=./packages/app/dist/client` → `./apps/main/dist/client`
- `deployment/README.md` — update path references

#### 7. `scripts/e2e-check.sh`
```bash
# Before
if [ -d "packages/app/dist" ] ...
# After
if [ -d "apps/main/dist" ] ...
```

#### 8. No test changes needed
Integration tests run against the Bun server at `packages/server/`, they don't reference `packages/app/` directly. The test setup imports from `@devpad/schema` and `@devpad/core`, not from app packages.

#### 9. `bunfig.toml` — check if paths are referenced
Need to verify. May need no changes.

#### 10. Apps' internal `package.json` files
Workspace dependency references like `"@devpad/schema": "workspace:*"` use package names, not paths. No changes needed inside app package.json files.

### Effort estimate: ~30 min mechanical work

---

## Part B: API Layer Unification

### Current State Analysis

**Three auth implementations:**
1. `packages/worker/src/middleware/auth.ts` (90 lines) — devpad auth. Resolves to `{id, github_id, name, task_view}` user + session. Uses `c.env.JWT_SECRET`.
2. `packages/blog-server/src/middleware/auth.ts` (211 lines) — blog auth. Has its own user model (`blog_users` table), validates API tokens against `blog_access_keys`, ensures blog user from devpad session, resolves JWT. Uses `ctx.jwt_secret` from blog context.
3. `packages/media-server/src/auth.ts` (121 lines) — media auth. Resolves to `{user_id, name, email, image_url}` auth context. Uses `c.env.JWT_SECRET`.

**Three context types:**
1. Worker `AppContext` — `{Bindings, Variables: {db, user, session}}`
2. Blog `AppContext` — `{db, corpus, devpad_db, jwt_secret, environment}`
3. Media `AppContext` — `{db, backend, providerFactory, encryptionKey, env}`

**Three error patterns:**
1. Core `ServiceError` — `{kind: "not_found" | "unauthorized" | ..., entity, id, message}`
2. Blog service errors — `{type: "not_found" | "db_error" | ..., resource?, message?}` (uses `type` not `kind`)
3. Media service errors — `{kind: "not_found" | "forbidden" | ..., message?, resource?, details?}` (13 kinds, defined in schema)

### Target State

#### Unified Auth Flow

The worker auth middleware already handles devpad auth. Blog and media need the same devpad user — they should not have separate auth.

**Blog's special case:** The blog currently has its own `blog_users` table and `blog_access_keys` table. It "ensures" a blog user from the devpad session. This is unnecessary complexity. The blog should authenticate via the devpad auth and get the devpad user ID. If the blog needs to store author metadata, that's a mapping from devpad user ID → blog author info, not a separate user table.

**However**, changing the blog user model is a database migration concern. For this plan, we take a pragmatic approach:
- Blog routes get the devpad user from the unified auth middleware
- Blog services that need a `blog_user_id` (numeric) do a lightweight lookup/ensure from the devpad user
- The blog's `ensureUser` logic moves into a thin blog-specific middleware that runs AFTER the unified auth

**Media's case:** Media already works with devpad user IDs directly (string). It just needs the auth context from the unified auth middleware.

#### Route Architecture

```
Worker (packages/worker/src/index.ts)
├── /health                          → health check
├── /api/v0/*                        → devpad routes (existing)
├── /api/auth/*                      → devpad auth routes (existing)
├── /api/blog/*                      → blog routes (NEW: mounted from blog-server)
├── /api/v1/timeline/*               → media routes (NEW: mounted from media-server)
├── /api/v1/connections/*            → media routes
├── /api/v1/credentials/*            → media routes
├── /api/v1/profiles/*               → media routes
├── /api/media-auth/*                → media auth routes (OAuth callbacks)
└── /api/blog-auth/*                 → blog auth routes
```

The hostname-based routing in `createUnifiedWorker` still works for Astro frontend serving. The API routing changes only affect the internal plumbing — blog and media APIs no longer create their own Hono apps with their own middleware stacks.

#### Changes by Package

### 1. `packages/worker/` — The unified entry point

**`packages/worker/src/bindings.ts`** — Expand `AppVariables` to carry blog/media contexts:

```typescript
export type AppVariables = {
  db: UnifiedDatabase;
  user: AuthUser;
  session: SessionData | null;
  // Blog domain context (set by blog middleware)
  blogContext?: BlogDomainContext;
  // Media domain context (set by media middleware)
  mediaContext?: MediaDomainContext;
};
```

**`packages/worker/src/middleware/auth.ts`** — No changes needed. It already handles JWT, API key, and session cookie auth. The existing `authMiddleware` sets `user` and `session`. The existing `requireAuth` blocks unauthenticated requests.

**`packages/worker/src/index.ts`** — Stop creating separate blog/media Hono apps. Instead:
- Import blog route sub-apps from `@devpad/blog-server/routes`
- Import media route sub-apps from `@devpad/media-server/routes`
- Mount them under the unified worker with shared middleware
- Blog/media sub-apps are "thin" — just route definitions that call services

**NEW: `packages/worker/src/middleware/blog.ts`** (~30 lines):
- Creates the blog domain context (corpus, blog db) from env bindings
- Ensures blog user from devpad auth user
- Sets `blogContext` on the Hono context

**NEW: `packages/worker/src/middleware/media.ts`** (~20 lines):
- Creates the media domain context (backend, providers, encryption key) from env bindings
- Sets `mediaContext` on the Hono context

**`packages/worker/src/routes/blog.ts`** (~15 lines):
- Imports blog route handlers from blog-server
- Mounts them with `dbMiddleware`, `authMiddleware`, `requireAuth`, `blogContextMiddleware`

**`packages/worker/src/routes/media.ts`** (~15 lines):
- Imports media route handlers from media-server
- Mounts them with `dbMiddleware`, `authMiddleware`, `requireAuth`, `mediaContextMiddleware`

### 2. `packages/blog-server/` — Gutted to services + routes only

**DELETE:**
- `src/middleware/auth.ts` (211 lines) — replaced by worker auth
- `src/middleware/require-auth.ts` (25 lines) — replaced by worker requireAuth
- `src/context.ts` (36 lines) — replaced by worker middleware
- `src/worker.ts` — no longer a standalone worker
- `src/utils/route-helpers.ts` (40 lines) — replaced by shared helpers
- `src/utils/errors.ts` (55 lines) — replaced by shared error mapping
- `src/utils/crypto.ts` — if only used by deleted auth (check)

**KEEP (unchanged):**
- `src/services/posts.ts` (539 lines) — core blog logic, uses `{db, corpus}` deps
- `src/services/tags.ts` (114 lines) — core blog logic
- `src/services/categories.ts` (201 lines) — core blog logic
- `src/services/tokens.ts` (138 lines) — blog access tokens
- `src/services/projects.ts` (58 lines) — project cache
- `src/corpus/posts.ts` (74 lines) — corpus operations
- `src/providers/devpad.ts` — devpad API integration

**MODIFY:**
- `src/index.ts` — change from `createApiApp()` factory to exporting route sub-apps
- `src/routes/*.ts` — change from using blog-local `withAuth`/`Variables`/`response` to using worker-provided context

**New export shape:**
```typescript
// packages/blog-server/src/index.ts
export { blogRoutes } from "./routes/index.ts";
export { createBlogDomainContext, type BlogDomainContext } from "./domain-context.ts";
export { createPostService } from "./services/posts.ts";
// ... etc
```

**Route changes pattern:**
```typescript
// Before (blog-server/src/routes/posts.ts)
postsRouter.get("/", zValidator("query", PostListParamsSchema), 
  withAuth(async (c, user, ctx) => {
    const service = createPostService({ db: ctx.db, corpus: ctx.corpus });
    const result = await service.list(user.id, params);
    return response.result(c, result);
  })
);

// After
postsRouter.get("/", requireAuth, zValidator("query", PostListParamsSchema),
  async (c) => {
    const blogCtx = c.get("blogContext");
    const user = c.get("blogUser"); // blog user ID (numeric)
    const service = createPostService({ db: blogCtx.db, corpus: blogCtx.corpus });
    const result = await service.list(user.id, params);
    return handleBlogResult(c, result);
  }
);
```

**New: `src/domain-context.ts`** (~40 lines):
```typescript
export type BlogDomainContext = {
  db: DrizzleDB;
  corpus: PostsCorpus;
};

export const createBlogDomainContext = (env: Bindings): BlogDomainContext => {
  // ... create corpus from env.DB + env.BLOG_CORPUS_BUCKET
};
```

**New: `src/errors.ts`** (~30 lines):
Thin adapter from blog's `{type: "not_found"}` service errors to HTTP responses, following the media-server `handleResult` pattern.

### 3. `packages/media-server/` — Gutted auth/middleware, keep domain logic

**DELETE:**
- `src/auth.ts` (121 lines) — replaced by worker auth
- `src/auth-ownership.ts` — moves to a local utility (it uses media db, not auth)
- `src/app.ts` (92 lines) — no longer creates its own Hono app
- `src/worker.ts` — no longer a standalone worker
- `src/http-errors.ts` — replaced by shared error handling
- `src/request-context.ts` — request ID generation not needed (or move to worker)

**KEEP (unchanged):**
- `src/services/` (all 4 files) — timeline, connections, credentials, profiles
- `src/platforms/` (all files) — platform providers, memory variants
- `src/cron/` (all files) — cron processors
- `src/timeline/` (all files) — grouping, loaders, normalizers, namespace, profile
- `src/storage.ts` — corpus store operations
- `src/sync.ts` — account syncing
- `src/token.ts` — OAuth token management
- `src/rate-limits.ts` — circuit breaker
- `src/merge.ts` — timeline merging
- `src/utils.ts` — crypto, encoding, date helpers
- `src/db.ts` — database factory
- `src/logger.ts` — logging
- `src/config.ts` — configuration
- `src/connection-delete.ts` — connection deletion logic
- `src/infrastructure/context.ts` — AppContext type (kept, but created by worker middleware)
- `src/bindings.ts` — createContextFromBindings (kept, used by worker middleware)
- `src/oauth-helpers.ts` — OAuth helper functions

**MODIFY:**
- `src/index.ts` — change exports to not include auth middleware, app factory
- `src/routes/*.ts` — change from using media-local auth to worker-provided auth context
- `src/auth-ownership.ts` — keep but rename/relocate since it's really a db-level ownership check, not auth
- `src/utils/route-helpers.ts` — keep `handleResult`, `handleResultWith`, etc.

**Route changes pattern:**
```typescript
// Before (media-server/src/routes/timeline.ts)
timelineRoutes.get("/:user_id", async c => {
  const auth = getAuth(c);      // media-local auth
  const ctx = getContext(c);     // media-local context
  ...
});

// After
timelineRoutes.get("/:user_id", async c => {
  const user = c.get("user");         // from worker auth
  const ctx = c.get("mediaContext");   // from worker middleware
  const userId = user.id;
  ...
});
```

### 4. `packages/schema/` — Minor additions

**`src/bindings.ts`** — Already has unified `Bindings` type. No changes needed.

### 5. Error Handling Alignment

**Current state:**
- Blog uses `{type: "not_found", resource}` — the error _field_ is `type`
- Media uses `{kind: "not_found", resource}` — the error _field_ is `kind`
- Core uses `{kind: "not_found", entity, id}` — the error _field_ is `kind`

**Target:** Blog services should switch from `type` to `kind` to align with core and media. This is a search-and-replace within blog-server service files.

**However**, this changes the internal API of blog services. Since no external consumers depend on these error shapes (they're mapped to HTTP responses internally), this is safe.

**Blog error migration:**
- `src/services/posts.ts` — change `PostServiceError.type` → `PostServiceError.kind`
- `src/services/tags.ts` — same
- `src/services/categories.ts` — same
- `src/services/tokens.ts` — same
- `src/utils/service-helpers.ts` — change `ServiceError.type` → `.kind`

This is ~50 occurrences across 6 files. Mechanical search-and-replace.

---

## Breaking Changes

### API URL preservation
- devpad: `/api/v0/*` → unchanged
- blog: Currently served at `blog.devpad.tools` with paths `/api/blog/*`, `/auth/*`, `/health` — the hostname routing in `createUnifiedWorker` still handles this. Internal API paths unchanged.
- media: Currently served at `media.devpad.tools` with paths `/api/v1/*`, `/api/auth/*`, `/health` — same.

**No external API URLs change.** The hostname-based routing remains. What changes is the internal plumbing — blog/media no longer instantiate their own Hono apps. The worker mounts their routes directly.

### Blog user model
The blog currently has its own `blog_users` table. After unification, blog routes receive the devpad user from the worker auth. A lightweight `ensureBlogUser` middleware converts devpad user → blog user ID. **No behavioral change for API consumers.**

### Backwards compatibility
- All 353 tests should pass — no API behavior changes
- The `packages/server/` Bun server only serves devpad routes, not blog/media. No changes needed there.
- Blog and media frontends (`apps/blog/`, `apps/media/`) call their APIs via `fetch()` to the hostname. No import-level changes.

---

## Final Directory Structure

```
devpad/
├── apps/
│   ├── main/                          # devpad Astro frontend (was packages/app)
│   │   ├── src/
│   │   │   ├── components/solid/
│   │   │   ├── pages/
│   │   │   ├── layouts/
│   │   │   └── utils/
│   │   └── package.json               # @devpad/app
│   ├── blog/                          # Blog Astro frontend (was packages/blog-app)
│   │   ├── src/
│   │   └── package.json               # @devpad/blog-app
│   └── media/                         # Media Astro frontend (was packages/media-app)
│       ├── src/
│       └── package.json               # @devpad/media-app
├── packages/
│   ├── schema/src/                    # Shared types, validation, DB schema (unchanged)
│   ├── core/src/                      # Auth + devpad services (unchanged)
│   │   ├── auth/
│   │   └── services/                  # projects.d1, tasks.d1, etc.
│   ├── scanner/src/                   # TypeScript scanner (unchanged)
│   ├── worker/src/                    # Unified CF Worker
│   │   ├── index.ts                   # createUnifiedWorker (MODIFIED)
│   │   ├── bindings.ts                # Expanded AppContext (MODIFIED)
│   │   ├── middleware/
│   │   │   ├── auth.ts                # Unified auth (unchanged)
│   │   │   ├── db.ts                  # DB middleware (unchanged)
│   │   │   ├── blog.ts                # Blog domain context (NEW)
│   │   │   └── media.ts              # Media domain context (NEW)
│   │   └── routes/
│   │       ├── v0.ts                  # devpad API routes (unchanged)
│   │       ├── auth.ts                # OAuth routes (unchanged)
│   │       ├── blog.ts                # Blog route mounting (NEW)
│   │       └── media.ts              # Media route mounting (NEW)
│   ├── blog-server/src/               # Blog domain logic (GUTTED)
│   │   ├── index.ts                   # Exports routes + services (MODIFIED)
│   │   ├── domain-context.ts          # BlogDomainContext factory (NEW)
│   │   ├── errors.ts                  # Blog error → HTTP response mapping (NEW, replaces utils/errors.ts)
│   │   ├── corpus/posts.ts            # Corpus operations (unchanged)
│   │   ├── providers/devpad.ts        # devpad API provider (unchanged)
│   │   ├── services/                  # Blog services (MODIFIED: type→kind errors)
│   │   │   ├── posts.ts
│   │   │   ├── tags.ts
│   │   │   ├── categories.ts
│   │   │   ├── tokens.ts
│   │   │   └── projects.ts
│   │   └── routes/                    # Route handlers (MODIFIED: use worker auth)
│   │       ├── posts.ts
│   │       ├── tags.ts
│   │       ├── categories.ts
│   │       ├── tokens.ts
│   │       ├── projects.ts
│   │       ├── auth.ts
│   │       └── health.ts
│   ├── media-server/src/              # Media domain logic (GUTTED)
│   │   ├── index.ts                   # Exports routes + services (MODIFIED)
│   │   ├── infrastructure/context.ts  # AppContext type (unchanged)
│   │   ├── bindings.ts                # Context factory (unchanged)
│   │   ├── services/                  # All services (unchanged)
│   │   ├── platforms/                 # Platform providers (unchanged)
│   │   ├── cron/                      # Cron processors (unchanged)
│   │   ├── timeline/                  # Timeline generation (unchanged)
│   │   ├── routes/                    # Route handlers (MODIFIED: use worker auth)
│   │   │   ├── timeline.ts
│   │   │   ├── connections.ts
│   │   │   ├── credentials.ts
│   │   │   ├── profiles.ts
│   │   │   └── auth.ts
│   │   └── (storage, sync, token, rate-limits, merge, utils, etc.)
│   ├── server/src/                    # Bun server (MODIFIED: path update)
│   ├── api/                           # Published @devpad/api (unchanged)
│   ├── cli/                           # CLI tool (unchanged)
│   └── mcp/                           # MCP server (unchanged)
├── scripts/
│   ├── build-unified.ts               # MODIFIED: app paths
│   └── ...
├── tests/                             # UNCHANGED
├── wrangler.toml                      # UNCHANGED
└── package.json                       # MODIFIED: workspaces
```

---

## Risk Assessment

| Change | Risk | Mitigation |
|--------|------|------------|
| Moving apps/ directories | Low | Mechanical, verified by `bun install` + build |
| Server path updates | Low | Single import path change, tested by server startup |
| Blog auth removal | Medium | Blog has its own user model; need `ensureBlogUser` shim |
| Media auth removal | Low | Media already uses devpad user IDs |
| Blog error type→kind rename | Low | Internal only, search-and-replace |
| Blog route refactor | Medium | Routes change how they access user/context |
| Media route refactor | Medium | Routes change how they access auth/context |
| Worker route mounting | Medium | New mounting code must preserve URL shapes |
| Deployment path updates | Low | Mechanical, verified by Docker build |

**Highest-risk item:** Blog auth unification. The blog has a separate `blog_users` table with numeric IDs. Blog services use `userId: number` everywhere. We need a reliable mapping from devpad user (string UUID) to blog user (numeric auto-increment ID). The existing `ensureUser` logic does this via `github_id` matching. We preserve this but move it to a middleware.

---

## Phased Task Breakdown

### Phase 1: Directory Move (no merge conflicts between tasks)
**Can be parallelized**

#### Task 1.1: Move app directories
- `mv packages/app apps/main`
- `mv packages/blog-app apps/blog`
- `mv packages/media-app apps/media`
- Create `apps/` directory first
- **Est: 5 lines changed (git mv)**

#### Task 1.2: Update root package.json
- Add `"apps/*"` to workspaces
- **Est: 1 line changed**

#### Task 1.3: Update build-unified.ts
- Change APPS directory paths
- **Est: 3 lines changed**

#### Task 1.4: Update server paths
- `packages/server/src/server.ts` — SSR handler import
- `packages/server/src/local.ts` — static path
- **Est: 2 lines changed**

#### Task 1.5: Update deployment paths
- All docker-compose files, Dockerfile, production.ts, README.md
- `scripts/e2e-check.sh`
- **Est: ~15 lines changed across 8 files**

#### Phase 1 Verification
- `bun install` (regenerate lockfile)
- `bun test` (all 353 tests pass)
- `bun run build:worker` (build succeeds — or check it manually)

---

### Phase 2: Blog Error Alignment (prerequisite for Phase 3)
**Single task, no parallelization needed**

#### Task 2.1: Rename blog error field `type` → `kind`
Files to modify:
- `packages/blog-server/src/services/posts.ts` — `PostServiceError` type + all references
- `packages/blog-server/src/services/tags.ts` — `TagServiceError` type + all references
- `packages/blog-server/src/services/categories.ts` — `CategoryServiceError` type + all references
- `packages/blog-server/src/services/tokens.ts` — `TokenServiceError` type + all references
- `packages/blog-server/src/utils/service-helpers.ts` — `ServiceError` type + `errors` factory
- `packages/blog-server/src/utils/errors.ts` — `BaseServiceError` type + `ERROR_MAPPINGS` keys
- `packages/blog-server/src/routes/*.ts` — any direct error type checks

Pattern: `type:` → `kind:` in error type definitions and all `error.type` → `error.kind` access patterns.

- **Est: ~50 occurrences across 8 files, ~100 lines touched**

#### Phase 2 Verification
- `bun test` (blog-server has no tests, but core/worker tests should still pass)

---

### Phase 3: Auth & Middleware Unification (sequential — high dependency)

#### Task 3.1: Create blog domain context middleware
Create `packages/worker/src/middleware/blog.ts`:
- Factory function to create `BlogDomainContext` from env bindings
- `ensureBlogUser` logic (moved from blog-server auth)
- Middleware that sets `blogContext` and `blogUser` on Hono context

Create `packages/blog-server/src/domain-context.ts`:
- `BlogDomainContext` type definition
- Export for worker middleware to use

- **Est: ~80 lines new code**

#### Task 3.2: Create media domain context middleware
Create `packages/worker/src/middleware/media.ts`:
- Factory function to create media `AppContext` from env bindings (moved from media-server/src/bindings.ts `createContextFromBindings`)
- Middleware that sets `mediaContext` on Hono context
- Map worker auth user to media auth context shape

- **Est: ~40 lines new code**

#### Task 3.3: Expand worker bindings
Modify `packages/worker/src/bindings.ts`:
- Add `blogContext`, `blogUser`, `mediaContext` to `AppVariables`

- **Est: ~15 lines changed**

#### Task 3.4: Create blog route mounting
Create `packages/worker/src/routes/blog.ts`:
- Import blog route handlers
- Apply `dbMiddleware` → `authMiddleware` → `requireAuth` → `blogContextMiddleware`
- Mount blog routes

- **Est: ~30 lines**

#### Task 3.5: Create media route mounting
Create `packages/worker/src/routes/media.ts`:
- Import media route handlers
- Apply `dbMiddleware` → `authMiddleware` → `requireAuth` → `mediaContextMiddleware`
- Mount media routes

- **Est: ~30 lines**

#### Task 3.6: Update worker index.ts
Modify `packages/worker/src/index.ts`:
- Remove blog/media Hono app creation
- Import and mount blog/media routes from new route files
- Adjust hostname routing to use unified routes for API requests
- Keep Astro frontend routing as-is

- **Est: ~40 lines changed**

#### Phase 3 Verification
- Worker builds successfully
- All 353 tests pass

---

### Phase 4: Blog Route Refactor (can be parallelized across route files)

#### Task 4.1: Refactor blog routes to use worker context
Modify all files in `packages/blog-server/src/routes/`:
- Remove `withAuth` wrapper, use `c.get("blogUser")` and `c.get("blogContext")`
- Remove `Variables` type import, use worker types
- Replace `response.result()` with a shared helper or inline error mapping

Files: `posts.ts`, `tags.ts`, `categories.ts`, `tokens.ts`, `projects.ts`, `auth.ts`, `health.ts`

- **Est: ~100 lines changed across 7 files**

#### Task 4.2: Update blog-server index.ts exports
- Remove `createApiApp` export
- Export route sub-apps and domain context factory
- Remove middleware exports

- **Est: ~30 lines changed**

#### Task 4.3: Delete blog-server dead code
- Delete `src/middleware/auth.ts`
- Delete `src/middleware/require-auth.ts`
- Delete `src/context.ts`
- Delete `src/worker.ts`
- Delete `src/utils/route-helpers.ts` (if fully replaced)

- **Est: 5 file deletions, ~370 lines removed**

#### Phase 4 Verification
- Blog API routes return correct responses
- Worker builds

---

### Phase 5: Media Route Refactor (can be parallelized across route files)

#### Task 5.1: Refactor media routes to use worker context
Modify all files in `packages/media-server/src/routes/`:
- Replace `getAuth(c)` with `c.get("user")` from worker auth
- Replace `getContext(c)` with `c.get("mediaContext")` from worker middleware
- Keep `handleResult` pattern (it's already good)

Files: `timeline.ts`, `connections.ts`, `credentials.ts`, `profiles.ts`, `auth.ts`

- **Est: ~80 lines changed across 5 files**

#### Task 5.2: Update media-server index.ts exports
- Remove `createApiApp` export
- Remove auth middleware exports
- Keep service, platform, cron, storage exports

- **Est: ~30 lines changed**

#### Task 5.3: Delete media-server dead code
- Delete or gut `src/app.ts` (92 lines)
- Delete or gut `src/auth.ts` (121 lines)
- Delete `src/worker.ts`
- Delete `src/http-errors.ts`
- Potentially keep `src/request-context.ts` if used elsewhere

- **Est: 4 file deletions, ~300 lines removed**

#### Phase 5 Verification
- Media API routes return correct responses
- Cron handler still works
- Worker builds

---

### Phase 6: Cleanup & Validation

#### Task 6.1: Update worker package.json dependencies
- Add `@devpad/blog-server` and `@devpad/media-server` as dependencies (they may already be there implicitly, but be explicit)

#### Task 6.2: Update blog-server package.json
- Remove `hono` from dependencies (routes are now mounted in worker)
- Or keep it as peer dependency since route files still use Hono types

#### Task 6.3: Run full test suite
- `bun test:unit` — all unit tests
- `bun test:integration` — all integration tests
- Manual verification of blog/media route responses

#### Task 6.4: Update AGENTS.md and README if needed
- Update repository structure section

---

## What to do NOW vs LATER

### Do NOW (this plan):
1. **Phase 1** — Directory restructure (low risk, high clarity benefit)
2. **Phase 2** — Blog error alignment (mechanical, needed for consistency)
3. **Phases 3-5** — Auth/middleware/route unification (the real work)
4. **Phase 6** — Cleanup

### Defer (separate effort):
1. **Blog user model simplification** — Remove `blog_users` table entirely, use devpad user IDs throughout. Requires database migration + blog service changes.
2. **Shared response helpers** — Create a `packages/core/src/http/` module with shared `handleResult` patterns. Currently blog and media have slightly different response shapes.
3. **v0 route splitting** — The `packages/worker/src/routes/v0.ts` at 711 lines could be split into `v0/projects.ts`, `v0/tasks.ts`, `v0/milestones.ts`, etc. Separate concern.
4. **Media service pattern alignment** — Media services take `(ctx, userId, ...)` where ctx includes db. Could be refactored to `(db, userId, ...)` like core, but requires changing the media context threading. Not worth the churn right now.

---

## Estimated Total Effort

| Phase | Estimated LOC changed | Time |
|-------|----------------------|------|
| Phase 1: Directory move | ~25 | 30 min |
| Phase 2: Error alignment | ~100 | 30 min |
| Phase 3: Auth/middleware | ~235 new | 2 hours |
| Phase 4: Blog routes | ~500 changed/deleted | 1.5 hours |
| Phase 5: Media routes | ~410 changed/deleted | 1.5 hours |
| Phase 6: Cleanup | ~30 | 30 min |
| **Total** | **~1,300** | **~6 hours** |

Lines removed (dead code): ~670 lines deleted
Lines added (new middleware + mounting): ~235 lines
Net: ~435 fewer lines of code
