# Phase 2: Unified Worker — Blog & Media Integration

## Executive Summary

**Recommendation: Option A — Copy as workspace packages.** Copy `packages/server/` and `apps/website/` from both dev-blog and media-timeline into devpad's monorepo as workspace packages, with minimal modifications.

The Phase 1 rewrite approach created **19,277 lines** of media-timeline code (vs the original's **8,431**) and duplicated all the blog services into a single monolithic file. This plan abandons that rewrite entirely and instead copies the battle-tested source code with surgical modifications to only what *must* change: auth (HTTP→D1), schema imports, and the build pipeline.

### Breaking Changes
- devpad's Astro app (`packages/app/`) will switch from `hono-astro-adapter` to `@astrojs/cloudflare`. This breaks the existing Bun-native `packages/server/` deployment path.
- The existing rewritten blog/media files in `packages/worker/src/services/blog*.ts`, `packages/worker/src/routes/blog.ts`, and `packages/worker/src/services/media/` will be deleted entirely.

---

## Decision: Why Option A

| Criteria | A: Copy as Packages | B: Git Submodules | C: Copy server only |
|---|---|---|---|
| Code isolation | Best — each domain stays self-contained | Good, but submodule management sucks | Okay, but Astro apps lose workspace resolution |
| Import changes | Need `@blog/schema` → `@devpad/schema` remapping | None (keep original paths) | Same as A |
| Build complexity | Medium — 3 Astro builds + 1 worker bundle | High — submodule sync + 3 builds | Same as A |
| Auth change | Must modify 1-2 files per project | Same | Same |
| Ongoing maintenance | Single repo, simple | Cross-repo sync hell | Same as A |
| Risk | Low — tested code, minimal changes | Medium — git submodule footguns | Low |

**Option B (submodules) is rejected** because: (1) submodules create terrible DX with syncing; (2) we'd still need to modify auth code, defeating the "zero changes" argument; (3) the workspace package approach with bun already gives us clean isolation.

**Option C** is basically Option A but incomplete — we'd need the Astro apps anyway, so there's no advantage to copying only the server dirs.

---

## Architecture: How 3 Astro Apps Coexist in One Worker

### The Core Problem
Cloudflare Workers serve ONE worker entry point. We need to serve 3 Astro SSR apps + 3 API route trees, all routed by hostname.

### Solution: Hostname Router + Separate Astro Builds

```
Request → CF Worker (_worker.js)
  │
  ├─ devpad.tools → devpad API (Hono) + devpad Astro SSR
  ├─ blog.devpad.tools → blog API (Hono) + blog Astro SSR  
  └─ media.devpad.tools → media API (Hono) + media Astro SSR + cron
```

Each Astro app builds independently into its own output directory. The unified worker entry imports all three Astro handlers and all three API apps, then routes by hostname.

### Static Assets
Cloudflare Workers Sites / Pages serves static files from the `dist/` directory. The key insight: **`_astro/` filenames are content-hashed**, so files from all 3 builds can be merged into a single `_astro/` directory without conflicts. Each Astro build produces files like `_astro/HowItWorks.abc123.js` — the hash prevents collisions.

### Build Output Structure
```
dist/
├── _worker.js                  # Unified entry point
├── _astro/                     # Merged static assets from all 3 Astro builds
│   ├── index.D6k8x.css         # devpad assets
│   ├── post-editor.B4n2.js     # blog assets
│   └── Dashboard.A9f3.js       # media assets
├── _devpad-worker/             # devpad Astro SSR handler
│   └── index.js
├── _blog-worker/               # blog Astro SSR handler
│   └── index.js
├── _media-worker/              # media Astro SSR handler
│   └── index.js
└── .assetsignore               # Exclude worker dirs from static serving
```

### Unified Worker Entry Point (Pseudocode)
```typescript
import devpadAstro from "./_devpad-worker/index.js";
import blogAstro from "./_blog-worker/index.js";
import mediaAstro from "./_media-worker/index.js";
import { createDevpadApi } from "./api/devpad.js";
import { createBlogApi } from "./api/blog.js";  
import { createMediaApi, handleScheduled } from "./api/media.js";

export default {
  async fetch(request, env, ctx) {
    const host = new URL(request.url).host;
    
    if (host.includes("blog.devpad.tools")) {
      return handleBlog(request, env, ctx);
    }
    if (host.includes("media.devpad.tools")) {
      return handleMedia(request, env, ctx);
    }
    return handleDevpad(request, env, ctx);
  },
  
  async scheduled(event, env, ctx) {
    return handleScheduled(event, env, ctx);
  }
};
```

Each `handle*` function checks if the path is API or static, then delegates appropriately.

---

## Final Monorepo Structure

```
devpad/
├── packages/
│   ├── schema/src/                    # EXISTING — unified schema
│   │   ├── database/schema.ts         # devpad tables
│   │   ├── database/blog.ts           # blog tables (already here)
│   │   ├── database/media.ts          # media tables (already here)
│   │   ├── database/d1.ts             # D1 factory (already here)
│   │   ├── bindings.ts                # Unified Bindings (already here)
│   │   ├── blog/                      # NEW — blog-specific types/validation/corpus
│   │   │   ├── types.ts               # Copied from dev-blog schema/src/types.ts
│   │   │   ├── corpus.ts              # Copied from dev-blog schema/src/corpus.ts
│   │   │   └── index.ts               # Re-exports for @devpad/schema/blog
│   │   └── media/                     # NEW — media-specific types/platforms/timeline
│   │       ├── index.ts               # Re-exports for @devpad/schema/media
│   │       ├── types.ts               # Copied from media-timeline schema/src/types.ts
│   │       ├── platforms.ts           # Copied from media-timeline schema/src/platforms.ts
│   │       ├── platforms/             # Copied from media-timeline schema/src/platforms/
│   │       ├── timeline.ts            # Copied from media-timeline schema/src/timeline.ts
│   │       ├── profiles.ts            # Copied from media-timeline schema/src/profiles.ts
│   │       ├── settings.ts            # Copied from media-timeline schema/src/settings.ts
│   │       ├── errors.ts              # Copied from media-timeline schema/src/errors.ts
│   │       └── branded.ts             # Copied from media-timeline schema/src/branded.ts
│   ├── core/src/                      # EXISTING — shared auth + devpad services
│   ├── worker/src/                    # EXISTING — unified worker entry
│   │   ├── index.ts                   # MODIFIED — hostname router
│   │   ├── middleware/auth.ts         # EXISTING — D1 auth middleware
│   │   ├── middleware/db.ts           # EXISTING
│   │   ├── routes/v0.ts               # EXISTING — devpad API routes
│   │   ├── routes/auth.ts             # EXISTING — OAuth routes
│   │   └── bindings.ts                # EXISTING
│   ├── blog-server/src/               # NEW — copied from dev-blog/packages/server/src/
│   │   ├── index.ts                   # createBlogApiApp() — MODIFIED for unified context
│   │   ├── context.ts                 # MODIFIED — use unified D1 + shared auth
│   │   ├── middleware/auth.ts         # REWRITTEN — use D1 auth instead of HTTP verify
│   │   ├── routes/*.ts                # Copied as-is
│   │   ├── services/*.ts              # Copied as-is
│   │   ├── corpus/posts.ts            # Copied as-is
│   │   ├── providers/devpad.ts        # MODIFIED — query D1 directly
│   │   └── utils/*.ts                 # Copied as-is
│   ├── media-server/src/              # NEW — copied from media-timeline/packages/server/src/
│   │   ├── app.ts                     # createMediaApiApp() — MODIFIED for unified context
│   │   ├── worker.ts                  # handleScheduled() — MODIFIED for unified context
│   │   ├── auth.ts                    # REWRITTEN — use D1 auth
│   │   ├── bindings.ts                # MODIFIED — use unified Bindings
│   │   ├── routes/*.ts                # Copied as-is
│   │   ├── services/*.ts              # Copied as-is
│   │   ├── platforms/*.ts             # Copied as-is
│   │   ├── timeline/*.ts              # Copied as-is
│   │   ├── cron/*.ts                  # Copied as-is
│   │   └── (rest)                     # Copied as-is
│   ├── blog-app/                      # NEW — copied from dev-blog/apps/website/
│   │   ├── src/pages/*.astro          # Copied as-is
│   │   ├── src/components/*.tsx        # Copied as-is
│   │   ├── src/lib/api.ts             # MINOR TWEAK — SSR path adjustment
│   │   ├── astro.config.mjs           # MODIFIED — alias updates
│   │   └── package.json
│   ├── media-app/                     # NEW — copied from media-timeline/apps/website/
│   │   ├── src/pages/*.astro          # Copied as-is
│   │   ├── src/components/*.tsx        # Copied as-is
│   │   ├── src/utils/api.ts           # MINOR TWEAK — SSR path adjustment
│   │   ├── astro.config.mjs           # MODIFIED — alias updates
│   │   └── package.json
│   └── app/                           # EXISTING devpad Astro app
│       └── astro.config.mjs           # MODIFIED — switch to @astrojs/cloudflare
├── scripts/
│   └── build-unified.ts               # NEW — builds all 3 Astro apps + bundles worker
├── wrangler.toml                      # EXISTING (already configured)
└── package.json                       # MODIFIED — add new workspaces
```

---

## Detailed File-Level Changes

### 1. Schema Package Expansion (`packages/schema/`)

The blog and media server packages currently import from `@blog/schema` and `@media/schema`. Rather than rewriting all 70+ import statements, we'll:

1. Copy the non-database schema files (types, validation, corpus, platforms, etc.) into `packages/schema/src/blog/` and `packages/schema/src/media/`
2. Add new export paths to `packages/schema/package.json`
3. The import rewrite then becomes a simple find-replace: `@blog/schema` → `@devpad/schema/blog` and `@media/schema` → `@devpad/schema/media`

**Files to copy into `packages/schema/src/blog/`:**
- `dev-blog/packages/schema/src/types.ts` → types + validation (zod schemas, API types, Bindings, AppContext)
- `dev-blog/packages/schema/src/corpus.ts` → corpus store definitions
- `dev-blog/packages/schema/src/tables.ts` → **NOT NEEDED** (already in `database/blog.ts`)

**Files to copy into `packages/schema/src/media/`:**
- `media-timeline/packages/schema/src/types.ts` → timeline types
- `media-timeline/packages/schema/src/platforms.ts` → platform enum/schemas
- `media-timeline/packages/schema/src/platforms/*.ts` → platform-specific schemas
- `media-timeline/packages/schema/src/timeline.ts` → timeline Zod schemas
- `media-timeline/packages/schema/src/profiles.ts` → profile validation
- `media-timeline/packages/schema/src/settings.ts` → settings schemas
- `media-timeline/packages/schema/src/errors.ts` → error types
- `media-timeline/packages/schema/src/branded.ts` → branded types
- `media-timeline/packages/schema/src/database.ts` → **NOT NEEDED** (already in `database/media.ts`, but need the `Database` type export and `corpus_snapshots`)

**Key type conflicts to resolve:**
- Both projects define their own `Bindings`, `AppContext`, `DrizzleDB`, `User` types. In the unified worker, we use the unified `Bindings` from `packages/schema/src/bindings.ts`. The blog/media-specific context types stay within their respective server packages.
- `@blog/schema` re-exports all of `@f0rbit/corpus` — the blog server code imports `ok`, `err`, `pipe`, etc. from `@blog/schema`. In the unified version, these should import directly from `@f0rbit/corpus`.

### 2. Blog Server (`packages/blog-server/`)

**Copy from:** `dev-blog/packages/server/src/` → `devpad/packages/blog-server/src/`

**Files that need modification:**

| File | Change | Reason |
|---|---|---|
| `middleware/auth.ts` | **Rewrite** (~100 lines) | Replace HTTP call to `devpad.tools/api/auth/verify` with local D1 session validation using `@devpad/core/auth` |
| `context.ts` | **Modify** (~15 lines) | Accept `UnifiedDatabase` + `R2Bucket` instead of `Bindings`; drop `devpadApi` field |
| `index.ts` | **Modify** (~10 lines) | Accept unified context params instead of `Bindings` |
| `providers/devpad.ts` | **Rewrite** (~30 lines) | Replace HTTP fetch of projects with direct D1 query using `@devpad/core/services/projects.d1` |
| All files | **Import rewrite** | `@blog/schema` → `@devpad/schema/blog` + `@devpad/schema/database/blog` (mechanical find-replace) |
| All files | **Corpus import** | `@blog/schema` corpus re-exports → direct `@f0rbit/corpus` imports |

**Files copied as-is (no changes):**
- `routes/posts.ts`, `routes/categories.ts`, `routes/tags.ts`, `routes/tokens.ts`, `routes/projects.ts`, `routes/health.ts`
- `services/posts.ts`, `services/categories.ts`, `services/tags.ts`, `services/tokens.ts`, `services/projects.ts`
- `corpus/posts.ts`
- `utils/crypto.ts`, `utils/errors.ts`, `utils/route-helpers.ts`, `utils/service-helpers.ts`
- `middleware/require-auth.ts`

**Deleted files (not needed in unified):**
- `worker.ts` — the unified worker handles the Astro/API split
- `routes/auth.ts` — auth is handled at the worker level

### 3. Media Server (`packages/media-server/`)

**Copy from:** `media-timeline/packages/server/src/` → `devpad/packages/media-server/src/`

**Files that need modification:**

| File | Change | Reason |
|---|---|---|
| `auth.ts` | **Rewrite** (~80 lines) | Replace all `verifySessionCookie/verifyJWT/verifyApiKey` HTTP calls with local D1 auth |
| `bindings.ts` | **Modify** (~20 lines) | Use unified `Bindings` type; adjust `createContextFromBindings` to accept unified bindings |
| `app.ts` | **Modify** (~15 lines) | Accept unified context; adjust API base path |
| `worker.ts` | **Modify** (~10 lines) | Export `handleScheduled` that accepts unified bindings |
| `auth-ownership.ts` | **No change** — only uses DB queries |
| All files | **Import rewrite** | `@media/schema` → `@devpad/schema/media` + `@devpad/schema/database/media` |
| `db.ts` | **Modify** (~3 lines) | Import from `@devpad/schema/database/media` instead of `@media/schema/database` |

**Files copied as-is (no changes):**
- All `routes/*.ts`
- All `services/*.ts`
- All `platforms/*.ts` (including memory variants)
- All `timeline/*.ts`
- All `cron/*.ts` (including processors)
- `sync.ts`, `storage.ts`, `token.ts`, `rate-limits.ts`, `merge.ts`, `http-errors.ts`, `oauth-helpers.ts`, `logger.ts`, `config.ts`
- `request-context.ts`, `infrastructure/context.ts`
- `connection-delete.ts`, `utils/route-helpers.ts`

**Deleted files:**
- `worker.ts` (the unified entry replaces this — but we keep `handleScheduled`)

### 4. Auth Rewrite Detail

This is the **critical architectural change** and the only part that's non-mechanical.

**Current (blog):** `middleware/auth.ts` makes HTTP call → `devpad.tools/api/auth/verify` → gets user → upserts into blog_users table.

**Unified:** Same D1 database is available. Use `@devpad/core/auth` functions directly:
```typescript
import { validateSession, jwtWeb, keysD1 } from "@devpad/core/auth";
import { createD1Database } from "@devpad/schema/database/d1";

// In middleware:
const db = createD1Database(env.DB);

// JWT auth
const jwt_result = await jwtWeb.verifyJWT(env.JWT_SECRET, token);
if (jwt_result.ok) {
  const session = await validateSession(db, jwt_result.value.session_id);
  // ... set user
}

// API key auth
const key_result = await keysD1.getUserByApiKey(db, token);
// ... set user

// Session cookie auth
const session_result = await validateSession(db, session_id);
// ... set user
```

This is exactly what `packages/worker/src/middleware/auth.ts` already does. The blog and media auth modules should be thin wrappers that call the same core functions, then map the result into their own `User`/`AuthContext` types.

**Current (media):** `auth.ts` makes HTTP calls to `devpad.tools/api/auth/verify` with various auth methods. Replace with same D1 approach.

**blog_users / media_users resolution:** The blog/media apps have their own `users` tables (blog_users, media_users) that are keyed by github_id. After D1 auth resolves the devpad user, we still need to upsert into the domain-specific users table. The existing `ensureBlogUser` pattern in the rewritten blog routes is correct — we just move it into the auth middleware.

### 5. devpad Astro App Conversion (`packages/app/`)

**Change:** Switch from `hono-astro-adapter` to `@astrojs/cloudflare`.

This affects:
- `packages/app/astro.config.mjs` — replace adapter
- `packages/app/package.json` — swap dependencies
- Any server-side code that relies on Bun/Node APIs not available in Workers

**Risk:** devpad's Astro app was built for Bun. It uses `hono-astro-adapter` and Bun-native features. The conversion may surface incompatibilities. However, the blog and media apps already work on Cloudflare, so the pattern is proven.

**Mitigation:** The existing `packages/server/` (Bun-native Hono server) stays for local development. The Cloudflare deployment uses the worker build.

### 6. Astro Frontend Apps

**Blog app (`packages/blog-app/`):**
- Copy from `dev-blog/apps/website/`
- Update `astro.config.mjs` vite alias: `@blog/schema` → resolved path to `packages/schema/src/blog/index.ts`
- Update `src/lib/api.ts` — the SSR internal fetch path stays the same (it uses `API_HANDLER` from env)
- No component changes needed

**Media app (`packages/media-app/`):**
- Copy from `media-timeline/apps/website/`
- Update `astro.config.mjs` vite alias: `@media/schema` → resolved path to `packages/schema/src/media/index.ts`
- Update `src/utils/api.ts` — adjust `API_HOST` and path prefixes if needed
- Update `src/utils/ssr-auth.ts` — replace HTTP verify with D1 auth (same change as server auth)
- No component changes needed

### 7. Unified Worker Entry (`packages/worker/src/index.ts`)

Replace the current placeholder with the hostname router:

```typescript
import { Hono } from "hono";
import { authMiddleware } from "./middleware/auth.js";
import { dbMiddleware } from "./middleware/db.js";
import v0Routes from "./routes/v0.js";
import authRoutes from "./routes/auth.js";
import { createBlogApiApp } from "@devpad/blog-server";
import { createMediaApiApp, handleScheduled as mediaScheduled } from "@devpad/media-server";
import type { AppContext, Bindings } from "./bindings.js";

// devpad API app
const devpadApp = new Hono<AppContext>();
devpadApp.use("/api/*", dbMiddleware);
devpadApp.use("/api/*", authMiddleware);
devpadApp.route("/api/v0", v0Routes);
devpadApp.route("/api/auth", authRoutes);

export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext) {
    const host = new URL(request.url).host;
    
    if (host.includes("blog.devpad.tools")) {
      return handleBlog(request, env, ctx);
    }
    if (host.includes("media.devpad.tools")) {
      return handleMedia(request, env, ctx);
    }
    return handleDevpad(request, env, ctx);
  },
  
  async scheduled(event, env, ctx) {
    return mediaScheduled(event, env, ctx);
  }
};
```

The `handleBlog`/`handleMedia`/`handleDevpad` functions each:
1. Check if the path is an API route → delegate to the Hono app
2. Otherwise → delegate to the Astro SSR handler

### 8. Build Pipeline (`scripts/build-unified.ts`)

```
1. Build devpad Astro → packages/app/dist/
2. Build blog Astro → packages/blog-app/dist/
3. Build media Astro → packages/media-app/dist/
4. Bundle worker entry → dist/_worker.js
5. Merge all _astro/ dirs → dist/_astro/
6. Copy each Astro SSR handler → dist/_devpad-worker/, dist/_blog-worker/, dist/_media-worker/
7. Generate _routes.json (merge all 3)
8. Generate .assetsignore
```

Steps 1-3 can run in parallel.

### 9. Cleanup — Delete Phase 1 Rewrite Files

**Delete entirely:**
- `packages/worker/src/services/blog.ts` (896 lines)
- `packages/worker/src/services/blog-corpus.ts` (86 lines)
- `packages/worker/src/routes/blog.ts` (373 lines)
- `packages/worker/src/services/media/` (entire directory, ~19,000 lines)

---

## Task Breakdown

### Phase 0: Approval Gate (BLOCKING)
Before any implementation, the auth rewrite approach needs approval. This is the only non-mechanical change and the highest-risk part.

**Deliverable:** A working `packages/blog-server/src/middleware/auth.ts` and `packages/media-server/src/auth.ts` that use `@devpad/core/auth` for D1-based auth. Test with existing integration tests.

### Phase 1: Schema Expansion (~300 LOC new, ~200 LOC modified)
*Can be parallelized across 2 agents*

**Task 1.1: Blog schema files** (~150 LOC)
- Copy `dev-blog/packages/schema/src/types.ts` → `packages/schema/src/blog/types.ts`
- Copy `dev-blog/packages/schema/src/corpus.ts` → `packages/schema/src/blog/corpus.ts`
- Create `packages/schema/src/blog/index.ts` re-export barrel
- Add export paths to `packages/schema/package.json`
- Remove/adjust the types that are now in `database/blog.ts` (avoid duplication of table types)
- **Must handle**: `@blog/schema` re-exports `@f0rbit/corpus` utilities (ok, err, pipe etc). The blog index.ts should re-export these too for minimal import changes.

**Task 1.2: Media schema files** (~350 LOC)
- Copy `media-timeline/packages/schema/src/types.ts` → `packages/schema/src/media/types.ts`
- Copy `media-timeline/packages/schema/src/platforms.ts` → `packages/schema/src/media/platforms.ts`
- Copy `media-timeline/packages/schema/src/platforms/` → `packages/schema/src/media/platforms/`
- Copy `media-timeline/packages/schema/src/timeline.ts` → `packages/schema/src/media/timeline.ts`
- Copy `media-timeline/packages/schema/src/profiles.ts` → `packages/schema/src/media/profiles.ts`
- Copy `media-timeline/packages/schema/src/settings.ts` → `packages/schema/src/media/settings.ts`
- Copy `media-timeline/packages/schema/src/errors.ts` → `packages/schema/src/media/errors.ts`
- Copy `media-timeline/packages/schema/src/branded.ts` → `packages/schema/src/media/branded.ts`
- Create `packages/schema/src/media/index.ts` re-export barrel (match the original `@media/schema` exports)
- Add export paths to `packages/schema/package.json` for `@devpad/schema/media`, `@devpad/schema/media/database`, `@devpad/schema/media/types`

**Verification:** TypeScript builds without errors.

### Phase 2: Copy & Rewrite Server Packages (~150 LOC new, ~500 LOC modified)
*Must happen after Phase 1. Can parallelize blog-server and media-server.*

**Task 2.1: Blog server package** (~2,200 LOC copied, ~200 LOC modified)
- Copy `dev-blog/packages/server/src/` → `packages/blog-server/src/`
- Create `packages/blog-server/package.json` with workspace dependencies
- Find-replace imports: `@blog/schema` → `@devpad/schema/blog` (20 files)
- Where `@blog/schema` was used for table imports (`users`, `posts`, `categories`, `tags`, `accessKeys`), point to `@devpad/schema/database/blog`
- Where `@blog/schema` was used for `@f0rbit/corpus` re-exports, point to `@f0rbit/corpus` directly
- Rewrite `middleware/auth.ts` to use D1 auth (~100 LOC)
- Modify `context.ts` to accept unified DB + R2 bucket (~15 LOC)
- Modify `providers/devpad.ts` to query D1 directly (~30 LOC)
- Delete `worker.ts` (not needed — unified worker handles this)
- Adjust `index.ts` to export `createBlogApiApp(db, bucket)` factory

**Task 2.2: Media server package** (~8,400 LOC copied, ~200 LOC modified)
- Copy `media-timeline/packages/server/src/` → `packages/media-server/src/`
- Create `packages/media-server/package.json` with workspace dependencies
- Find-replace imports: `@media/schema` → `@devpad/schema/media` (49 files)
- Where `@media/schema/database` was used, point to `@devpad/schema/database/media`
- Rewrite `auth.ts` to use D1 auth (~80 LOC)
- Modify `bindings.ts` to use unified Bindings, adjust `createContextFromBindings` (~20 LOC)
- Modify `app.ts` to export `createMediaApiApp(env)` with correct bindings (~15 LOC)
- Modify `worker.ts` to export `handleScheduled(event, env, ctx)` using unified bindings (~10 LOC)
- Modify `db.ts` to import from `@devpad/schema/database/media` (~3 LOC)

**Verification:** Both packages compile. Blog server auth works with D1. Media server auth works with D1.

### Phase 3: Copy Astro Apps (~0 LOC new, ~50 LOC modified per app)
*Can happen in parallel with Phase 2 for the non-auth parts. Depends on Phase 1.*

**Task 3.1: Blog Astro app**
- Copy `dev-blog/apps/website/` → `packages/blog-app/`
- Create `packages/blog-app/package.json` (based on existing, add workspace deps)
- Update `astro.config.mjs` — change vite alias to point to monorepo schema paths
- Update any `@blog/schema` imports in Astro pages/components
- `src/lib/api.ts` — no changes needed (already uses relative /api/ paths + API_HANDLER pattern)

**Task 3.2: Media Astro app**
- Copy `media-timeline/apps/website/` → `packages/media-app/`
- Create `packages/media-app/package.json`
- Update `astro.config.mjs` — change vite aliases
- Update `@media/schema` imports (mainly in `src/utils/api.ts` which imports types)
- Update `src/utils/ssr-auth.ts` — replace HTTP verify with D1 auth

**Task 3.3: Convert devpad Astro app**
- Change `packages/app/astro.config.mjs`: replace `hono-astro-adapter` with `@astrojs/cloudflare`
- Update `packages/app/package.json`: swap adapter dependency
- Add `mode: "advanced"` to cloudflare adapter config
- Test that existing pages render correctly

**Verification:** Each Astro app builds independently with `astro build`.

### Phase 4: Unified Worker Entry + Build Pipeline (~300 LOC)
*Depends on Phases 2 & 3*

**Task 4.1: Worker entry rewrite** (~150 LOC)
- Rewrite `packages/worker/src/index.ts` with hostname-based routing
- Import blog and media API app factories
- Import Astro SSR handlers (will be injected at build time)
- Wire up `scheduled` handler for media cron
- Wire up API_HANDLER injection for SSR internal calls

**Task 4.2: Build script** (~150 LOC)
- Create `scripts/build-unified.ts`
- Build all 3 Astro apps (parallel)
- Bundle worker entry with esbuild/bun
- Merge `_astro/` directories
- Copy SSR handlers to named directories
- Merge `_routes.json` files
- Generate `.assetsignore`

**Verification:** `bun run build:worker` produces a deployable `dist/` directory. `wrangler dev` serves all 3 domains locally.

### Phase 5: Cleanup (~0 LOC new, -20,000 LOC deleted)
*After Phase 4 verification*

**Task 5.1: Delete rewrite files**
- Delete `packages/worker/src/services/blog.ts`
- Delete `packages/worker/src/services/blog-corpus.ts`
- Delete `packages/worker/src/routes/blog.ts`
- Delete `packages/worker/src/services/media/` (entire directory)

**Verification:** Full build still works. All routes still respond.

---

## Effort Estimates

| Task | Est. LOC | Effort | Parallelizable |
|---|---|---|---|
| 1.1 Blog schema | ~150 | 1h | Yes (with 1.2) |
| 1.2 Media schema | ~350 | 2h | Yes (with 1.1) |
| 2.1 Blog server | ~200 modified | 3h | Yes (with 2.2) |
| 2.2 Media server | ~200 modified | 3h | Yes (with 2.1) |
| 3.1 Blog Astro app | ~50 modified | 1h | Yes (with 3.2, 3.3) |
| 3.2 Media Astro app | ~50 modified | 1h | Yes (with 3.1, 3.3) |
| 3.3 devpad Astro conversion | ~30 modified | 2h | Yes (with 3.1, 3.2) |
| 4.1 Worker entry | ~150 | 2h | No |
| 4.2 Build script | ~150 | 2h | Yes (with 4.1) |
| 5.1 Cleanup | -20,000 | 30min | No |
| **Total** | **~1,330 new/modified** | **~17h** | |

With maximum parallelization: ~8h of wall-clock time.

---

## Risks & Mitigations

### Risk 1: Drizzle Schema Conflicts
**Problem:** Blog uses table name `users`, media uses table name `media_users`. Both are in the unified D1. Blog's `users` table conflicts with devpad's `user` table.
**Status:** Already handled — `database/blog.ts` renames to `blog_users`. The blog server code already references `blog_users` in the Phase 1 schema.
**Mitigation:** The blog server code imports table definitions from `@devpad/schema/database/blog` which uses `blog_users`. Need to verify the blog server's services don't import the old `users` table name.

### Risk 2: Corpus Backend Compatibility
**Problem:** Blog and media use different corpus patterns. Blog uses a custom `blogCorpus` wrapper (already in Phase 1 rewrite). Media uses `create_cloudflare_backend` directly.
**Mitigation:** Both use `@f0rbit/corpus` under the hood with D1+R2 backends. The unified worker provides both `BLOG_CORPUS_BUCKET` and `MEDIA_CORPUS_BUCKET`. Each domain's context creation uses its own bucket.

### Risk 3: Astro Static Asset Collisions
**Problem:** If two Astro builds produce a file with the same content-hash, they could collide.
**Mitigation:** Astro uses a combination of file content + path for hashing. The probability of collision is effectively zero. But we should verify by checking the merged `_astro/` directory for duplicates during the build.

### Risk 4: devpad Astro Conversion
**Problem:** devpad's app uses `hono-astro-adapter` (Bun-native) and may use Node/Bun APIs not available in Workers.
**Mitigation:** Start with a minimal conversion. If it breaks, we can keep devpad's Astro on Bun and only serve the API from the worker (with a separate Pages deployment for the frontend). But the blog/media apps prove the pattern works.

### Risk 5: Import Volume
**Problem:** 70+ files need `@blog/schema` / `@media/schema` import rewrites.
**Mitigation:** This is purely mechanical — a find-replace operation. No logic changes. Can be verified with TypeScript compilation.

---

## Limitations

1. **Single Worker RAM:** All three apps share a single CF Worker's 128MB memory limit. If total bundle + runtime exceeds this, we'd need to split into separate workers with service bindings.

2. **Cold Start:** The unified bundle will be larger than individual workers, potentially increasing cold start time. Monitor after deployment.

3. **Independent Deployment:** With a unified worker, you can't deploy blog changes without also deploying devpad and media changes. This is fine for a solo developer but would be problematic for a team.

4. **Local Dev:** Running all 3 Astro apps locally requires `wrangler dev` or a custom dev script. The existing `bun dev` for devpad's app continues to work independently.
