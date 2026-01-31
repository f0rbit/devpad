# Convergence Plan: blog-server & media-server into core + worker

## Executive Summary

**Goal:** Eliminate `packages/blog-server/` and `packages/media-server/` as standalone packages by absorbing their functionality into `packages/core/` (services/business logic), `packages/worker/` (routes/middleware), and `packages/api/` (client methods).

**Verdict: Full convergence is the right call**, but with subdirectory isolation within core and worker. The packages already depend on worker for response utilities and schema for types. They're thin wrappers - the architecture is 90% there already.

**Estimated total effort:** ~2,500 lines changed across ~45 files. 6 phases, parallelizable.

**Breaking changes:** 
- All imports from `@devpad/blog-server` and `@devpad/media-server` will break
- Worker's `package.json` will gain new dependencies (corpus, etc)
- Core's `package.json` will gain new dependencies (corpus, drizzle-orm/d1)
- Any external consumers of `@devpad/media-server` subpath exports will break (tests, apps)

---

## Current State Analysis

### blog-server (16 files, ~1,200 LOC)

| Layer | Files | LOC | Complexity |
|-------|-------|-----|------------|
| Services | 4 (posts, tags, categories, tokens) | ~1,010 | Medium - posts.ts is the heaviest at 539 lines |
| Routes | 5 (posts, tags, categories, tokens, health) | ~360 | Low - thin wrappers calling services |
| Middleware | 1 (require-auth) | 27 | Trivial |
| Utils | 3 (route-helpers, service-helpers, crypto) | ~52 | Trivial - route-helpers re-exports from worker |
| Corpus | 1 (posts corpus adapter) | 74 | Low |
| Context | 1 (AppContext factory) | 33 | Trivial |

**Key observations:**
- `route-helpers.ts` literally re-exports from `@devpad/worker/utils/response` - it's a shim
- `service-helpers.ts` is 24 lines of generic utility (could merge into core/services/errors.ts)
- `require-auth.ts` pulls user + blogContext from Hono variables - standard pattern
- Services are dependency-injected via `{ db, corpus }` - clean, moves easily
- `crypto.ts` is 17 lines (SHA-256 hashing) - duplicates media-server's `secrets.key()`

### media-server (49 files, ~4,500 LOC)

| Layer | Files | LOC | Complexity |
|-------|-------|-----|------------|
| Services | 5 (timeline, connections, profiles, credentials, index) | ~1,430 | High - connections.ts alone is 761 lines |
| Routes | 6 (timeline, connections, profiles, credentials, auth, index) | ~870 | Medium - credentials has Reddit-specific inline logic |
| Platforms | 13 (providers + memory providers) | ~1,200 | High - 6 platform providers + memory test doubles |
| Cron | 4 (index, platform-processor, github/reddit/twitter processors) | ~450 | Medium |
| Timeline | 5 (index, namespace, grouping, loaders, normalizers, profile) | ~500 | Medium |
| Infrastructure | 7 (context, bindings, auth, auth-ownership, oauth-helpers, token, db) | ~750 | Medium |
| Utilities | 5 (utils, logger, merge, rate-limits, storage, sync, request-context) | ~1,100 | Medium - sync.ts is 556 lines |
| Route helpers | 1 | 27 | Trivial - re-exports from worker |

**Key observations:**
- `route-helpers.ts` re-exports from `@devpad/worker/utils/response` (same as blog-server)
- `auth.ts` is 22 lines - extracts user from Hono context
- `oauth-helpers.ts` is 450 lines of OAuth flow logic - this is the most complex piece
- `storage.ts` defines corpus store patterns - pure infrastructure, no route dependency
- `platforms/` has a clean Provider interface with memory test doubles - this is well-architected
- Services use `AppContext` (db + backend + providerFactory + encryptionKey) - slightly different from blog's simpler context
- `sync.ts` orchestrates account processing + timeline generation - core business logic

### worker (13 files, ~1,000 LOC)

Already acts as the composition root:
- `index.ts` imports from both blog-server and media-server, mounts routes
- `middleware/context.ts` creates both blog and media contexts from env bindings
- `utils/response.ts` provides shared response handling (already consumed by both servers)

### core (30 files, ~2,000 LOC)

Currently only has devpad-specific services (projects, tasks, scanning, etc). No blog or media code.

### api (7 files, ~500 LOC)

Only covers devpad operations. No blog or media client methods.

---

## Architecture Decision: Subdirectory Isolation

Rather than dumping everything into flat service files, use domain subdirectories:

```
packages/core/src/
├── services/
│   ├── blog/               # NEW - blog business logic
│   │   ├── posts.ts        # from blog-server/services/posts.ts
│   │   ├── tags.ts         # from blog-server/services/tags.ts
│   │   ├── categories.ts   # from blog-server/services/categories.ts
│   │   ├── tokens.ts       # from blog-server/services/tokens.ts
│   │   ├── corpus.ts       # from blog-server/corpus/posts.ts
│   │   ├── context.ts      # from blog-server/context.ts  
│   │   └── index.ts        # barrel export
│   ├── media/              # NEW - media business logic
│   │   ├── connections.ts   # from media-server/services/connections.ts
│   │   ├── profiles.ts      # from media-server/services/profiles.ts
│   │   ├── credentials.ts   # from media-server/services/credentials.ts
│   │   ├── timeline.ts      # from media-server/services/timeline.ts
│   │   ├── sync.ts          # from media-server/sync.ts
│   │   ├── storage.ts       # from media-server/storage.ts
│   │   ├── auth-ownership.ts # from media-server/auth-ownership.ts
│   │   ├── oauth-helpers.ts  # from media-server/oauth-helpers.ts
│   │   ├── token.ts          # from media-server/token.ts
│   │   ├── context.ts        # from media-server/infrastructure/context.ts + bindings.ts
│   │   └── index.ts          # barrel export
│   ├── media/platforms/     # NEW - platform providers
│   │   ├── types.ts
│   │   ├── github.ts
│   │   ├── reddit.ts
│   │   ├── twitter.ts
│   │   ├── bluesky.ts
│   │   ├── youtube.ts
│   │   ├── devpad.ts
│   │   ├── memory-base.ts
│   │   ├── github-memory.ts
│   │   ├── reddit-memory.ts
│   │   ├── twitter-memory.ts
│   │   └── index.ts
│   ├── media/cron/          # NEW - cron processing
│   │   ├── index.ts
│   │   ├── platform-processor.ts
│   │   └── processors/
│   │       ├── github.ts
│   │       ├── reddit.ts
│   │       └── twitter.ts
│   ├── media/timeline/      # NEW - timeline processing
│   │   ├── index.ts
│   │   ├── namespace.ts
│   │   ├── grouping.ts
│   │   ├── loaders.ts
│   │   ├── normalizers.ts
│   │   └── profile.ts
│   ├── projects.ts          # existing
│   ├── tasks.ts             # existing
│   ├── ...                  # existing devpad services
│   ├── errors.ts            # EXTENDED - absorb blog/media service-helpers
│   └── index.ts             # UPDATED - add blog/media exports
├── utils/
│   ├── crypto.ts            # NEW - merged from blog crypto + media secrets
│   ├── logger.ts            # NEW - from media-server/logger.ts
│   └── ...existing

packages/worker/src/
├── routes/
│   ├── v1/                  # SPLIT from monolithic v1.ts into domain route files
│   │   ├── index.ts         # barrel - mounts all sub-routers under /api/v1
│   │   ├── projects.ts      # /projects, /projects/:id/*, /repos/* (from v1.ts)
│   │   ├── tasks.ts         # /tasks, /tasks/* (from v1.ts)
│   │   ├── milestones.ts    # /milestones, /milestones/:id/* (from v1.ts)
│   │   ├── goals.ts         # /goals, /goals/:id/* (from v1.ts)
│   │   ├── keys.ts          # /keys, /keys/:id (from v1.ts)
│   │   ├── user.ts          # /user/*, /me (from v1.ts)
│   │   ├── tags.ts          # /tags (from v1.ts)
│   │   ├── scanning.ts      # /projects/scan, /projects/updates, /projects/scan_status (from v1.ts)
│   │   ├── blog/            # /blog/* (from blog-server/routes/*)
│   │   │   ├── index.ts     # mounts posts, tags, categories, tokens
│   │   │   ├── posts.ts
│   │   │   ├── tags.ts
│   │   │   ├── categories.ts
│   │   │   └── tokens.ts
│   │   └── media/           # /timeline/*, /connections/*, etc (from media-server/routes/*)
│   │       ├── index.ts     # mounts timeline, connections, credentials, profiles
│   │       ├── timeline.ts
│   │       ├── connections.ts
│   │       ├── profiles.ts
│   │       ├── credentials.ts
│   │       └── auth.ts      # /auth/platforms/* (OAuth callbacks)
│   ├── auth.ts              # existing auth routes (login, logout, OAuth)
│   └── v1.ts                # DELETE after migration
├── middleware/
│   ├── auth.ts             # existing
│   ├── context.ts          # UPDATED - inline context creation (remove imports)
│   └── db.ts               # existing
├── index.ts                # UPDATED - remove blog-server/media-server imports, use routes/v1/
└── ...existing

packages/api/src/
├── api-client.ts           # UPDATED - add blog + media namespaces
└── ...existing
```

---

## What Can Move As-Is vs What Needs Refactoring

### Move as-is (copy + update imports):
- All blog-server services (posts, tags, categories, tokens)
- Blog corpus adapter
- All media-server services (connections, profiles, credentials, timeline)
- All platform providers + memory providers
- All cron processors
- All timeline processing (grouping, loaders, normalizers, profile)
- Storage patterns
- Sync module
- Auth ownership
- OAuth helpers
- Token utilities
- Rate limits
- Merge utilities
- Logger

### Needs refactoring:
1. **Blog `route-helpers.ts`** - Delete entirely (it's just a re-export shim)
2. **Blog `require-auth.ts`** - Inline into blog route file or create shared `withAuth` in worker
3. **Media `route-helpers.ts`** - Delete entirely (same shim pattern)
4. **Media `auth.ts`** - Delete (22 lines, inline `getAuth` into routes or use worker's user)
5. **Blog `service-helpers.ts`** - Merge into `core/services/errors.ts`
6. **Blog `crypto.ts`** - Merge with media `secrets` into `core/utils/crypto.ts`
7. **Worker `index.ts`** - Update all imports, remove blog-server/media-server deps
8. **Worker `middleware/context.ts`** - Import context factories from core instead
9. **Worker `bindings.ts`** - Update Variables type (remove separate blog/media context types)
10. **Blog/media context types** - Unified into a single `AppContext` in worker, or separate blog/media contexts from core

### Naming conflicts:
- `blog/tags.ts` vs existing `core/services/tags.ts` - **No conflict**: blog tags are post-tags, core tags are task-tags. Different domain.
- `AppContext` - Both blog and media define this differently. Solution: `BlogContext` and `MediaContext` in core, composed in worker.

---

## Dependency Changes

### core/package.json additions:
```json
{
  "@f0rbit/corpus": "^0.3.4",
  "hono": "^4.6.0"  // only needed for oauth-helpers Context type
}
```

**Wait - pushback point:** `hono` in core is wrong. OAuth helpers reference `Context` from Hono. Two options:
1. Move oauth-helpers to worker (it's route-adjacent)
2. Abstract the Hono dependency out of oauth-helpers

**Recommendation:** Move `oauth-helpers.ts` and `auth.ts` (media) to worker, not core. They're HTTP-layer concerns. The pure functions (`decodeOAuthStateData`, `validateTokenResponse`, `calculateTokenExpiry`) can stay in core. The Hono-dependent functions (`createOAuthCallback`, `validateOAuthRequest`, redirect helpers) go to worker.

Revised core additions:
```json
{
  "@f0rbit/corpus": "^0.3.4"
}
```

### worker/package.json additions:
```json
{
  "@f0rbit/corpus": "^0.3.4"
}
```
(Already has hono, drizzle-orm, zod)

### Removals from worker:
```json
{
  "@devpad/blog-server": "workspace:*",  // DELETE
  "@devpad/media-server": "workspace:*"  // DELETE
}
```

### api/package.json - no changes needed (it only depends on @devpad/schema)

---

## Migration Task Breakdown

### Phase 1: Shared infrastructure into core (parallel-safe)
**No dependencies between tasks. All touch different files.**

| Task | Description | Est. LOC | Files touched |
|------|-------------|----------|---------------|
| 1a | Move `blog-server/utils/service-helpers.ts` content into `core/services/errors.ts` | ~30 | 2 |
| 1b | Create `core/utils/crypto.ts` merging blog crypto + media secrets | ~180 | 3 (new file + adapt references) |
| 1c | Move `media-server/logger.ts` to `core/utils/logger.ts` | ~50 | 2 |
| 1d | Move `media-server/rate-limits.ts` to `core/services/media/rate-limits.ts` | ~80 | 2 |
| 1e | Move `media-server/merge.ts` to `core/services/media/merge.ts` | ~50 | 2 |
| 1f | Move `media-server/connection-delete.ts` to `core/services/media/connection-delete.ts` | ~80 | 2 |
| 1g | Move `media-server/request-context.ts` to `core/services/media/request-context.ts` | ~50 | 2 |

**Verification:** typecheck, test

### Phase 2: Blog services + corpus into core (parallel-safe)
**All blog files are independent from media files.**

| Task | Description | Est. LOC | Files touched |
|------|-------------|----------|---------------|
| 2a | Move blog context + corpus adapter to `core/services/blog/` | ~110 | 3 new files |
| 2b | Move blog services (posts, tags, categories, tokens) to `core/services/blog/` | ~1,010 | 5 (4 services + index) |
| 2c | Create `core/services/blog/index.ts` barrel export | ~20 | 1 |
| 2d | Update `core/package.json` to add `@f0rbit/corpus` dependency | ~5 | 1 |
| 2e | Add `./services/blog` export to `core/package.json` exports map | ~5 | 1 |

**Verification:** typecheck, test

### Phase 3: Media services + platforms into core (parallel-safe, but large)
**Multiple agents can work on different media subdirectories.**

| Task | Description | Est. LOC | Files touched |
|------|-------------|----------|---------------|
| 3a | Move media context + db + bindings to `core/services/media/context.ts` | ~80 | 3 |
| 3b | Move auth-ownership to `core/services/media/auth-ownership.ts` | ~65 | 2 |
| 3c | Move storage.ts to `core/services/media/storage.ts` | ~210 | 2 |
| 3d | Move all platform providers to `core/services/media/platforms/` | ~1,200 | 14 files |
| 3e | Move timeline processing to `core/services/media/timeline/` | ~500 | 6 files |
| 3f | Move cron processing to `core/services/media/cron/` | ~450 | 5 files |
| 3g | Move sync.ts to `core/services/media/sync.ts` | ~560 | 2 |
| 3h | Move services (connections, profiles, credentials, timeline) to `core/services/media/` | ~1,430 | 5 files |
| 3i | Move pure OAuth functions + token.ts to `core/services/media/` | ~300 | 3 |
| 3j | Create `core/services/media/index.ts` barrel + update core exports | ~40 | 2 |

**Verification:** typecheck, test

### Phase 4: Split v1.ts + absorb blog/media routes (parallel-safe within groups)

The current `v1.ts` is a 720-line monolith. Blog/media routes are already mounted at `/api/v1/blog/*` and `/api/v1/*` (timeline, connections, etc) in `worker/index.ts`. This phase:
1. Splits the existing v1.ts into domain route files
2. Moves blog-server routes into `routes/v1/blog/`
3. Moves media-server routes into `routes/v1/media/`
4. Creates a barrel `routes/v1/index.ts` that composes everything

**Group A: Split existing v1.ts (parallel - each touches different routes)**

| Task | Description | Est. LOC | Files touched |
|------|-------------|----------|---------------|
| 4a-1 | Extract project routes → `routes/v1/projects.ts` (GET/PATCH /projects, /projects/:id/history, /projects/config, /projects/save_config, /projects/public, /repos/*) | ~230 | 1 new |
| 4a-2 | Extract task routes → `routes/v1/tasks.ts` (GET/PATCH /tasks, /tasks/history/:id, /tasks/save_tags) | ~120 | 1 new |
| 4a-3 | Extract milestone routes → `routes/v1/milestones.ts` (GET/POST/PATCH/DELETE /milestones, /projects/:id/milestones) | ~120 | 1 new |
| 4a-4 | Extract goal routes → `routes/v1/goals.ts` (GET/POST/PATCH/DELETE /goals, /milestones/:id/goals) | ~100 | 1 new |
| 4a-5 | Extract key routes → `routes/v1/keys.ts` (GET/POST/DELETE /keys) | ~50 | 1 new |
| 4a-6 | Extract user routes → `routes/v1/user.ts` (PATCH /user/preferences, GET /user/history, GET /me) | ~50 | 1 new |
| 4a-7 | Extract tag routes → `routes/v1/tags.ts` (GET /tags) | ~15 | 1 new |
| 4a-8 | Extract scanning routes → `routes/v1/scanning.ts` (POST /projects/scan, GET /projects/updates, POST /projects/scan_status) | ~70 | 1 new |

**Group B: Blog + media routes (parallel with Group A)**

| Task | Description | Est. LOC | Files touched |
|------|-------------|----------|---------------|
| 4b-1 | Move blog routes → `routes/v1/blog/` (posts, tags, categories, tokens) | ~350 | 5 new files |
| 4b-2 | Move media routes → `routes/v1/media/` (timeline, connections, profiles, credentials) | ~870 | 5 new files |
| 4b-3 | Move Hono-dependent OAuth helpers → `routes/v1/media/auth.ts` | ~200 | merge into existing |

**Group C: Wire up (sequential, after A + B)**

| Task | Description | Est. LOC | Files touched |
|------|-------------|----------|---------------|
| 4c-1 | Create `routes/v1/index.ts` barrel that mounts all sub-routers | ~40 | 1 new |
| 4c-2 | Delete old `routes/v1.ts` | -720 | 1 deleted |
| 4c-3 | Update `index.ts` to use `routes/v1/` barrel instead of monolithic v1.ts | ~10 | 1 modified |

**Verification:** typecheck, test

**URL structure (unchanged — all existing URLs preserved):**
```
/api/v1/projects          → routes/v1/projects.ts
/api/v1/tasks             → routes/v1/tasks.ts
/api/v1/milestones        → routes/v1/milestones.ts
/api/v1/goals             → routes/v1/goals.ts
/api/v1/keys              → routes/v1/keys.ts
/api/v1/tags              → routes/v1/tags.ts
/api/v1/user/*            → routes/v1/user.ts
/api/v1/me                → routes/v1/user.ts
/api/v1/repos/*           → routes/v1/projects.ts
/api/v1/blog/*            → routes/v1/blog/
/api/v1/timeline/*        → routes/v1/media/
/api/v1/connections/*     → routes/v1/media/
/api/v1/credentials/*     → routes/v1/media/
/api/v1/profiles/*        → routes/v1/media/
/api/auth/*               → routes/auth.ts
/api/auth/platforms/*     → routes/v1/media/auth.ts
```

### Phase 5: Update worker composition root + bindings (sequential)
**Must happen after phases 2-4.**

| Task | Description | Est. LOC | Files touched |
|------|-------------|----------|---------------|
| 5a | Update `worker/src/index.ts` - remove blog-server/media-server imports, use core + local routes | ~50 | 1 |
| 5b | Update `worker/src/middleware/context.ts` - import from core | ~20 | 1 |
| 5c | Update `worker/src/bindings.ts` - reference core context types | ~15 | 1 |
| 5d | Update `worker/package.json` - remove blog-server/media-server deps, add corpus | ~10 | 1 |
| 5e | Update core `services/index.ts` and `index.ts` with blog + media exports | ~20 | 2 |

**Verification:** typecheck, full integration test suite

### Phase 6: Cleanup (parallel-safe)
**Deletion + API client work are independent.**

| Task | Description | Est. LOC | Files touched |
|------|-------------|----------|---------------|
| 6a | Delete `packages/blog-server/` entirely | -1,200 | delete directory |
| 6b | Delete `packages/media-server/` entirely | -4,500 | delete directory |
| 6c | Remove from root `package.json` workspaces | ~5 | 1 |
| 6d | Add blog + media namespaces to `packages/api/src/api-client.ts` | ~200 | 1 |
| 6e | Update any test imports referencing old packages | ~100 | varies |
| 6f | Update `apps/main`, `apps/blog`, `apps/media` imports if they reference the old packages | ~50 | varies |

**Verification:** full test suite, build all apps

---

## Risk Areas

1. **media-server `oauth-helpers.ts` is the riskiest file** - 450 lines of OAuth flow with Hono Context dependency. Splitting pure functions (core) from HTTP handlers (worker) requires careful surgical cuts. If any import is wrong, OAuth flows break silently (redirects to error pages).

2. **media-server `connections.ts` at 761 lines** - This is the most complex service. It imports from 8+ internal modules. Moving it requires getting all transitive dependencies right.

3. **`sync.ts` at 556 lines** - Core orchestration module that ties together platforms, storage, timeline, and cron. It's the hub of the media domain. Must move atomically with its dependencies.

4. **Test imports** - The test suite at `tests/integration/` and `packages/*/src/__tests__/` may import from `@devpad/blog-server` or `@devpad/media-server`. Need a pass to update all test imports.

5. **Worker `index.ts` scheduled handler** - The `createContextFromBindings` + `handleCron` call in the `scheduled()` export needs to work after migration.

6. **Subpath exports** - `@devpad/media-server` has ~20 subpath exports in package.json. Any app code using `@devpad/media-server/platforms/github` etc needs updating. Core will need equivalent exports.

---

## Alternative Considered: Light-touch approach

Instead of full convergence, we could:
- Keep blog-server and media-server as packages
- Just make them re-export from core (flip the dependency)
- Routes stay where they are

**Why this is worse:**
- Adds an unnecessary indirection layer
- blog-server is only 1,200 LOC - not worth maintaining a separate package for
- media-server already depends on worker for response utils - the dependency graph is tangled
- Two packages that exist just to re-export from core is worse than no packages

**The full convergence is cleaner.** These packages are thin enough that the migration is manageable, and the end state is simpler. The only thing we gain from keeping them is "smaller diffs" which doesn't matter since we're not worrying about backwards compatibility.

---

## Core exports map (post-migration)

```json
{
  ".": "./src/index.ts",
  "./services": "./src/services/index.ts",
  "./services/blog": "./src/services/blog/index.ts",
  "./services/media": "./src/services/media/index.ts",
  "./services/media/platforms": "./src/services/media/platforms/index.ts",
  "./services/media/platforms/github": "./src/services/media/platforms/github.ts",
  "./services/media/platforms/reddit-memory": "./src/services/media/platforms/reddit-memory.ts",
  "./services/media/platforms/twitter-memory": "./src/services/media/platforms/twitter-memory.ts",
  "./services/media/cron": "./src/services/media/cron/index.ts",
  "./services/media/timeline": "./src/services/media/timeline/index.ts",
  "./services/media/storage": "./src/services/media/storage.ts",
  "./services/media/sync": "./src/services/media/sync.ts",
  "./auth": "./src/auth/index.ts",
  "./logger": "./src/utils/client-logger.ts",
  "./utils/context": "./src/utils/context-parser.ts",
  "./utils/crypto": "./src/utils/crypto.ts"
}
```

---

## Summary Table

| Package | Current files | After migration | Destination |
|---------|--------------|-----------------|-------------|
| blog-server | 16 files | 0 (deleted) | core/services/blog/ + worker/routes/blog.ts |
| media-server | 49 files | 0 (deleted) | core/services/media/ + worker/routes/media/ |
| core | 30 files | ~70 files | Gains all business logic |
| worker | 13 files | ~22 files | Gains all routes |
| api | 7 files | 7 files | Updated api-client.ts |

**Net effect:** 2 packages deleted, 0 new packages created. Simpler dependency graph. One place for business logic (core), one place for HTTP routing (worker).
