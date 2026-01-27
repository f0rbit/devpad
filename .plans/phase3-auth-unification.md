# Phase 3: Auth/Middleware Unification

## Executive Summary

Merge three separate auth systems (devpad, blog, media) into one unified middleware chain in the worker. The worker already has `blogContextMiddleware` and `mediaContextMiddleware` that bridge devpad auth into domain-specific auth contexts. What remains is rewiring the worker's `index.ts` to mount blog/media route sub-apps directly (instead of delegating to standalone `createApiApp()` factories), exporting those sub-apps from blog-server and media-server, fixing 2 missed `c.get("appContext")` / `c.get("auth")` callsites in `oauth-helpers.ts`, and deleting the now-dead standalone app code.

## Findings & Analysis

### Already Done (Previous Session)
- Worker bindings expanded: `blogContext`, `blogUser`, `blogJwtToken`, `mediaContext`, `mediaAuth`
- `worker/src/middleware/blog.ts` — creates blog context + ensures blog user from devpad auth
- `worker/src/middleware/media.ts` — creates media context + sets mediaAuth from devpad user
- Blog route helpers updated to read `blogUser`/`blogContext`/`blogJwtToken`
- Media route helpers updated: `getContext()` tries `mediaContext` first, `getAuth()` tries `mediaAuth` first
- All blog/media route files (posts, tags, categories, tokens, projects, timeline, connections, credentials, profiles) use the updated wrappers — **no changes needed**

### Critical Bug Found
**`packages/media-server/src/oauth-helpers.ts`** has 2 stale callsites that bypass the updated `getContext()`/`getAuth()` helpers:
1. **Line 387**: `c.get("appContext")` — will be `undefined` when mounted through worker (should use `getContext(c)`)
2. **Line 177**: `c.get("auth")` — will be `undefined` when mounted through worker (should use `getAuth(c)` from `../auth`)

These MUST be fixed or OAuth flows (Reddit/Twitter/GitHub connect) will crash.

### Architecture After This Change

```
Request → Worker fetch()
  ├─ blog.devpad.tools
  │   ├─ /api/blog/* → dbMiddleware → authMiddleware → blogContextMiddleware → blog route sub-apps
  │   ├─ /health     → blogContextMiddleware → healthRouter (no auth needed)
  │   ├─ /auth/*     → blogContextMiddleware → authRouter (no auth needed)
  │   └─ /*          → Astro handler (with API_HANDLER for SSR)
  ├─ media.devpad.tools
  │   ├─ /api/v1/*   → dbMiddleware → authMiddleware → mediaContextMiddleware → media route sub-apps
  │   ├─ /api/auth/* → dbMiddleware → authMiddleware(optional) → mediaContextMiddleware → authRoutes
  │   ├─ /health     → healthRouter
  │   └─ /*          → Astro handler (with API_HANDLER for SSR)
  └─ devpad.tools
      └─ (unchanged)
```

### Key Constraint: Media OAuth Routes

Media OAuth has 3 route categories with different auth requirements:
1. **`/api/auth/reddit`, `/api/auth/twitter`, `/api/auth/github`** — Initiate OAuth. These call `oauth.query.profile()` which tries API key first, then cookie auth. They need `mediaContext` (for DB) and optionally `mediaAuth`.
2. **`/api/auth/reddit/callback`, etc.** — OAuth callbacks from providers. These are fully PUBLIC (no auth). They need `mediaContext` only (for DB + encryption).
3. **`/api/auth/login`, `/api/auth/callback`, `/api/auth/logout`** — Session management. Public endpoints.

The worker's unified auth middleware (`authMiddleware`) sets `user = null` when unauthenticated (it doesn't 401). The `mediaContextMiddleware` always sets `mediaContext` and conditionally sets `mediaAuth` only if `user` exists. So the middleware chain `dbMiddleware → authMiddleware → mediaContextMiddleware` works correctly for all 3 categories — the route handlers themselves enforce auth when needed via `getAuth()`.

### Key Constraint: Blog Auth Routes

Blog has:
1. **`/auth/status`** — reads `blogUser`, optional auth
2. **`/auth/logout`** — no auth needed
3. **`/health`** — reads `blogContext` for environment, no auth needed

The worker auth middleware sets `user = null` for unauthenticated requests. `blogContextMiddleware` always sets `blogContext` and conditionally sets `blogUser`. The blog `withAuth()` wrapper returns 401 when `blogUser` is null. This works correctly.

## Breaking Changes

- **`createApiApp`** exported from `@devpad/blog-server` will be replaced with route sub-app exports. Any consumers of `createApiApp()` break.
- **`createApiApp`** exported from `@devpad/media-server` will be removed. `createUnifiedApp` from `worker.ts` also removed.
- **`createBlogApiApp`** import in worker `index.ts` is removed.
- **`createMediaApiApp`** import in worker `index.ts` is removed.

These are all internal — no external consumers.

---

## Task Breakdown

### Work Unit 1: Fix media oauth-helpers + export media route sub-apps (~40 LOC changed)
**Files:**
- `packages/media-server/src/oauth-helpers.ts` — FIX
- `packages/media-server/src/index.ts` — MODIFY exports

**No dependencies. Can run in parallel with Work Unit 2.**

#### Task 1A: Fix oauth-helpers.ts stale callsites

**File:** `packages/media-server/src/oauth-helpers.ts`

**Change 1 — Line 387:** Replace `c.get("appContext")` with `getContext(c)` import.

Add import at top:
```typescript
import { getContext } from "./utils/route-helpers";
```

Change line 387:
```typescript
// BEFORE:
const ctx = c.get("appContext");
if (!ctx) throw new Error("AppContext not set");

// AFTER:
const ctx = getContext(c);
```
(`getContext` already throws if not set)

**Change 2 — Line 177:** Replace `c.get("auth")` with the same fallback pattern used in `auth.ts`.

```typescript
// BEFORE (line 177):
const auth = c.get("auth");

// AFTER:
const auth = (c as any).get("mediaAuth") ?? c.get("auth");
```

NOTE: We can't import `getAuth` here because that would create a circular dependency (`oauth-helpers.ts` ← `auth.ts` → `oauth-helpers.ts`... actually let me check). Actually `oauth-helpers.ts` does NOT import from `auth.ts`, and `auth.ts` does NOT import from `oauth-helpers.ts`. So we CAN import `getAuth` from `./auth`:

```typescript
import { getAuth } from "./auth";
```

But wait — `getAuth` throws if auth is not found. In `validateOAuthQueryKeyAndProfile`, the code checks `auth?.user_id` — meaning auth can be null/undefined. So we should NOT use `getAuth` (which throws). Instead, inline the fallback:

```typescript
// BEFORE (line 177):
const auth = c.get("auth");

// AFTER:
const auth = (c as any).get("mediaAuth") ?? c.get("auth");
```

This matches the pattern in `auth.ts:37` exactly.

#### Task 1B: Update media-server index.ts exports

**File:** `packages/media-server/src/index.ts`

The worker needs to import individual route sub-apps. Currently line 56 already exports:
```typescript
export { authRoutes, connectionRoutes, profileRoutes, timelineRoutes, token } from "./routes/index";
```

But `credentialRoutes` is missing from the re-export! Check the routes/index.ts:
```typescript
export { credentialRoutes } from "./credentials";
```

It IS in routes/index.ts. Let me check the main index.ts export line 56 again... Yes, `credentialRoutes` is NOT in the main index.ts export. But the worker is going to import from `@devpad/media-server/routes` (using the package.json `./routes` export), not from `@devpad/media-server` directly. So this is fine — the routes are already exported via `@devpad/media-server/routes`.

Actually, let me reconsider. The cleanest approach for the worker is to import routes from `@devpad/media-server/routes`. The package.json already has:
```json
"./routes": {
  "types": "./src/routes/index.ts",
  "import": "./src/routes/index.ts"
}
```

So **no changes needed to media-server/src/index.ts exports**.

The only remaining question: does the worker still need `createContextFromBindings` and `createProviderFactory` for the `scheduled()` handler? Yes — line 118 of current worker index.ts uses these for cron. These are already exported.

**Revised: Task 1B is not needed. Work Unit 1 is just the oauth-helpers fix.**

---

### Work Unit 2: Export blog route sub-apps (~15 LOC changed)
**Files:**
- `packages/blog-server/src/index.ts` — MODIFY to also export route sub-apps

**No dependencies. Can run in parallel with Work Unit 1.**

**File:** `packages/blog-server/src/index.ts`

Add exports for the individual routers that the worker will mount. Currently the file exports `createApiApp`, `ApiApp`, and `AppContext`.

Add these exports:
```typescript
export { postsRouter } from "./routes/posts";
export { tagsRouter } from "./routes/tags";
export { categoriesRouter } from "./routes/categories";
export { tokensRouter } from "./routes/tokens";
export { projectsRouter } from "./routes/projects";
export { healthRouter } from "./routes/health";
export { authRouter } from "./routes/auth";
```

The `createApiApp` function can stay for now (we delete it in Work Unit 3E). Keeping it avoids breaking anything during parallel work.

Actually, blog-server's package.json has `"./*": "./src/*.ts"` as an export, so the worker can already import `@devpad/blog-server/routes/posts` etc. directly. But that's a deep import. Adding explicit re-exports from index.ts is cleaner.

**Decision: Add re-exports to `packages/blog-server/src/index.ts`.** This is a minor additive change.

---

### Work Unit 3: Worker index.ts rewrite + deletions (~120 LOC changed)
**Files:**
- `packages/worker/src/index.ts` — REWRITE
- `packages/blog-server/src/middleware/auth.ts` — DELETE (211 lines)
- `packages/blog-server/src/worker.ts` — DELETE (45 lines)
- `packages/media-server/src/app.ts` — DELETE (92 lines)
- `packages/media-server/src/worker.ts` — DELETE (74 lines)

**Depends on Work Units 1 and 2 completing first.**

#### Task 3A: Rewrite worker/src/index.ts

**File:** `packages/worker/src/index.ts`

Replace the current file. The new version:

1. Removes imports of `createBlogApiApp` and `createMediaApiApp`
2. Imports blog route sub-apps from `@devpad/blog-server`
3. Imports media route sub-apps from `@devpad/media-server/routes`
4. Creates `createBlogApi()` — a Hono app that mounts `dbMiddleware → authMiddleware → blogContextMiddleware` then routes
5. Creates `createMediaApi()` — a Hono app that mounts `dbMiddleware → authMiddleware → mediaContextMiddleware` then routes
6. Keeps the hostname-based routing and Astro handler delegation

```typescript
import type { Bindings } from "@devpad/schema/bindings";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AppContext } from "./bindings.js";
import { authMiddleware } from "./middleware/auth.js";
import { blogContextMiddleware } from "./middleware/blog.js";
import { dbMiddleware } from "./middleware/db.js";
import { mediaContextMiddleware } from "./middleware/media.js";
import authRoutes from "./routes/auth.js";
import v0Routes from "./routes/v0.js";

// Blog route sub-apps
import {
  postsRouter,
  tagsRouter,
  categoriesRouter,
  tokensRouter,
  projectsRouter,
  healthRouter as blogHealthRouter,
  authRouter as blogAuthRouter,
} from "@devpad/blog-server";

// Media route sub-apps + cron deps
import { createContextFromBindings, createProviderFactory, handleCron } from "@devpad/media-server";
import {
  authRoutes as mediaAuthRoutes,
  connectionRoutes,
  credentialRoutes,
  profileRoutes,
  timelineRoutes,
} from "@devpad/media-server/routes";
import { requestContextMiddleware } from "@devpad/media-server";

type AstroHandler = {
  fetch: (request: Request, env: any, ctx: ExecutionContext) => Promise<Response>;
};

type ApiHandler = {
  fetch: (request: Request) => Promise<Response>;
};

type UnifiedHandlers = {
  devpad: AstroHandler;
  blog: AstroHandler;
  media: AstroHandler;
};

const BLOG_API_PREFIXES = ["/api/blog/", "/auth/", "/health"];
const MEDIA_API_PREFIXES = ["/api/v1/", "/api/auth/", "/health"];

const matchesPrefix = (path: string, prefixes: string[]) =>
  prefixes.some(p => path.startsWith(p) || path === p.replace(/\/$/, ""));

// --- devpad API (unchanged) ---
const createDevpadApi = () => {
  const app = new Hono<AppContext>();
  app.get("/health", c => c.json({ status: "ok" }));
  app.use("/api/*", dbMiddleware);
  app.use("/api/*", authMiddleware);
  app.route("/api/v0", v0Routes);
  app.route("/api/auth", authRoutes);
  return app;
};

// --- Blog API: unified middleware → blog routes ---
const createBlogApi = () => {
  const app = new Hono<AppContext>();

  // All routes get db + auth + blog context
  app.use("*", dbMiddleware);
  app.use("*", authMiddleware);
  app.use("*", blogContextMiddleware);

  // Blog routes (same structure as old createApiApp)
  const blogRouter = new Hono<AppContext>();
  blogRouter.route("/posts", postsRouter);
  blogRouter.route("/tags", tagsRouter);
  blogRouter.route("/categories", categoriesRouter);
  blogRouter.route("/tokens", tokensRouter);
  blogRouter.route("/projects", projectsRouter);

  app.route("/api/blog", blogRouter);
  app.route("/health", blogHealthRouter);
  app.route("/auth", blogAuthRouter);

  app.notFound(c => c.json({ code: "NOT_FOUND", message: "Resource not found" }, 404));
  app.onError((error, c) => {
    console.error("Blog unhandled error:", error);
    return c.json({ code: "INTERNAL_ERROR", message: error.message }, 500);
  });

  return app;
};

// --- Media API: unified middleware → media routes ---
const createMediaApi = () => {
  const app = new Hono<AppContext>();

  // Request context for logging
  app.use("*", requestContextMiddleware());

  // CORS for media
  app.use("*", cors({
    origin: origin => {
      const allowed = ["http://localhost:4321", "http://localhost:3000", "https://media.devpad.tools", "https://devpad.tools"];
      if (!origin || allowed.includes(origin)) return origin;
      if (origin.endsWith(".workers.dev") || origin.endsWith(".pages.dev")) return origin;
      return null;
    },
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "Auth-Token"],
    credentials: true,
  }));

  // All API routes get db + auth + media context
  app.use("/api/*", dbMiddleware);
  app.use("/api/*", authMiddleware);
  app.use("/api/*", mediaContextMiddleware);

  app.get("/health", c => c.json({ status: "ok", timestamp: new Date().toISOString() }));

  app.route("/api/auth", mediaAuthRoutes);
  app.route("/api/v1/timeline", timelineRoutes);
  app.route("/api/v1/connections", connectionRoutes);
  app.route("/api/v1/credentials", credentialRoutes);
  app.route("/api/v1/profiles", profileRoutes);

  // /api/v1/me inline route
  app.get("/api/v1/me", c => {
    const auth = (c as any).get("mediaAuth") ?? c.get("auth");
    if (!auth) return c.json({ error: "Unauthorized" }, 401);
    return c.json({
      id: auth.user_id,
      name: auth.name,
      email: auth.email,
      image_url: auth.image_url,
    });
  });

  app.post("/api/auth/logout", c => {
    return c.json({ redirect: "https://devpad.tools/logout" });
  });

  return app;
};

const hostnameFor = (request: Request) => {
  const host = request.headers.get("host") || new URL(request.url).host;
  return host.toLowerCase();
};

export function createUnifiedWorker(handlers: UnifiedHandlers) {
  const devpadApi = createDevpadApi();
  const blogApi = createBlogApi();
  const mediaApi = createMediaApi();

  return {
    async fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
      const hostname = hostnameFor(request);
      const path = new URL(request.url).pathname;

      if (hostname.includes("blog.devpad.tools")) {
        if (matchesPrefix(path, BLOG_API_PREFIXES)) {
          return blogApi.fetch(request, env, ctx);
        }
        const apiHandler: ApiHandler = { fetch: (req: Request) => blogApi.fetch(req, env, ctx) };
        return handlers.blog.fetch(request, { ...env, API_HANDLER: apiHandler }, ctx);
      }

      if (hostname.includes("media.devpad.tools")) {
        if (matchesPrefix(path, MEDIA_API_PREFIXES)) {
          return mediaApi.fetch(request, env, ctx);
        }
        const apiHandler: ApiHandler = { fetch: (req: Request) => mediaApi.fetch(req, env, ctx) };
        return handlers.media.fetch(request, { ...env, API_HANDLER: apiHandler }, ctx);
      }

      if (path.startsWith("/api/") || path === "/health") {
        return devpadApi.fetch(request, env, ctx);
      }
      const apiHandler: ApiHandler = { fetch: (req: Request) => devpadApi.fetch(req, env, ctx) };
      return handlers.devpad.fetch(request, { ...env, API_HANDLER: apiHandler }, ctx);
    },

    async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext): Promise<void> {
      const app_ctx = createContextFromBindings(env, createProviderFactory(env.DB));
      ctx.waitUntil(handleCron(app_ctx));
    },
  };
}

export type { AstroHandler, ApiHandler, UnifiedHandlers };
```

**Key decisions in this rewrite:**
1. Blog and media Hono apps are created ONCE at startup (not per-request like the old `createBlogHandler`/`createMediaHandler`).
2. The worker's `authMiddleware` sets `user = null` for unauthenticated requests (doesn't 401). This is correct because blog's `withAuth()` and media's `getAuth()` handle 401s themselves.
3. Media CORS is replicated from `app.ts` since the worker now owns the middleware chain.
4. The `/api/v1/me` and `/api/auth/logout` inline routes from `app.ts` are moved into `createMediaApi()`.
5. `requestContextMiddleware` from media-server is applied for logging continuity.

**Important note on auth middleware behavior:** The worker's `authMiddleware` (in `middleware/auth.ts`) does NOT return 401. It sets `user: null` and calls `next()`. This is the correct behavior needed for:
- Blog's `/auth/status` (optional auth) and `/auth/logout` (no auth)
- Media's OAuth initiation routes (optional auth — uses cookie if available)
- Media's OAuth callback routes (no auth at all)
- Blog's `/health` (no auth)

The domain-specific auth enforcement happens at the route handler level:
- Blog: `withAuth()` returns 401 if `blogUser` is null
- Media: `getAuth()` throws if `mediaAuth` is null (caught by route handlers)

#### Task 3B: Delete dead files

After Task 3A is verified working, delete these files:

1. **`packages/blog-server/src/middleware/auth.ts`** (211 lines) — The blog's own auth middleware. No longer needed since the worker's `authMiddleware` + `blogContextMiddleware` handles all auth.

2. **`packages/blog-server/src/worker.ts`** (45 lines) — The blog's standalone worker entry point. The worker now creates and mounts blog routes directly.

3. **`packages/media-server/src/app.ts`** (92 lines) — The media's standalone `createApiApp()`. The worker now creates and mounts media routes directly.

4. **`packages/media-server/src/worker.ts`** (74 lines) — The media's standalone worker entry point. The worker handles everything.

**After deletion, update exports:**

5. **`packages/media-server/src/index.ts`** — Remove the line:
   ```typescript
   export { type ApiAppConfig, type AppContext, createApiApp, type MediaBindings, type ProviderFactory } from "./app";
   ```
   Replace with (keep types that might be needed):
   ```typescript
   export type { AppContext } from "./infrastructure/context";
   export type { ProviderFactory } from "./platforms/types";
   ```
   
   Also remove:
   ```typescript
   export { type ApiHandler, type AstroEnv, createUnifiedApp, handleScheduled, type UnifiedApp } from "./worker";
   ```

6. **`packages/blog-server/src/index.ts`** — Remove `authMiddleware` import (line 4), remove `app.use("*", authMiddleware)` (line 33). But since we're keeping `createApiApp` in this file for now (might still be referenced in tests), we should be careful. Actually, let's check if anything imports `createApiApp`:

   The worker's old `index.ts` imported it as `createBlogApiApp`. After the rewrite, nothing will import it. So we can clean it up, but it's not strictly required for correctness. Let's leave the `createApiApp` function but remove the `authMiddleware` import since that file is being deleted.

   Actually, `createApiApp` references `authMiddleware` on line 33. If we delete `middleware/auth.ts`, `createApiApp` breaks. So we have two choices:
   
   a) Delete `createApiApp` entirely from `index.ts`
   b) Keep `middleware/auth.ts` alive
   
   Since nothing imports `createApiApp` after the worker rewrite, **delete it**. Replace the entire `index.ts` with just the route exports.

#### Task 3C: Update blog-server/src/index.ts after deletions

**File:** `packages/blog-server/src/index.ts`

Replace entire file:
```typescript
export { postsRouter } from "./routes/posts";
export { tagsRouter } from "./routes/tags";
export { categoriesRouter } from "./routes/categories";
export { tokensRouter } from "./routes/tokens";
export { projectsRouter } from "./routes/projects";
export { healthRouter } from "./routes/health";
export { authRouter } from "./routes/auth";

export type { AppContext } from "./context";
export { createContextFromDeps } from "./context";
```

#### Task 3D: Update media-server/src/index.ts after deletions

**File:** `packages/media-server/src/index.ts`

Remove the two export lines referencing `./app` and `./worker`. Keep everything else.

```typescript
// Remove this line:
export { type ApiAppConfig, type AppContext, createApiApp, type MediaBindings, type ProviderFactory } from "./app";

// Replace with:
export type { AppContext } from "./infrastructure/context";
export type { ProviderFactory } from "./platforms/types";

// Remove this line entirely:
export { type ApiHandler, type AstroEnv, createUnifiedApp, handleScheduled, type UnifiedApp } from "./worker";
```

---

## Phase Plan for Parallel Execution

### Phase 1: Parallel fixes (2 agents)

**Agent A: Fix media oauth-helpers** (~5 LOC)
- `packages/media-server/src/oauth-helpers.ts`
  - Add `import { getContext } from "./utils/route-helpers";` 
  - Line 387: Replace `const ctx = c.get("appContext"); if (!ctx) throw new Error("AppContext not set");` with `const ctx = getContext(c);`
  - Line 177: Replace `const auth = c.get("auth");` with `const auth = (c as any).get("mediaAuth") ?? c.get("auth");`
- Do NOT run build/test.

**Agent B: Add blog route re-exports** (~10 LOC)
- `packages/blog-server/src/index.ts`
  - Add re-exports for all route sub-apps at the end of the file (before the final export line):
    ```typescript
    export { postsRouter } from "./routes/posts";
    export { tagsRouter } from "./routes/tags";
    export { categoriesRouter } from "./routes/categories";
    export { tokensRouter } from "./routes/tokens";
    export { projectsRouter } from "./routes/projects";
    export { healthRouter } from "./routes/health";
    export { authRouter } from "./routes/auth";
    ```
- Do NOT run build/test.

**Verification Agent:**
- Run `bun check` from `apps/main`
- Run `bun test unit`
- Fix any issues
- DO NOT COMMIT

### Phase 2: Worker rewrite (1 agent, sequential)

**Agent C: Rewrite worker index.ts**
- `packages/worker/src/index.ts` — Full rewrite as specified in Task 3A above
- Do NOT run build/test.

**Verification Agent:**
- Run `bun check` from `apps/main`
- Run `bun test unit`
- Fix any issues
- DO NOT COMMIT

### Phase 3: Cleanup deletions (1 agent, sequential)

**Agent D: Delete dead code + update index exports**
- DELETE `packages/blog-server/src/middleware/auth.ts`
- DELETE `packages/blog-server/src/worker.ts`
- DELETE `packages/media-server/src/app.ts`
- DELETE `packages/media-server/src/worker.ts`
- REWRITE `packages/blog-server/src/index.ts` — Replace with clean route-only exports (Task 3C)
- MODIFY `packages/media-server/src/index.ts` — Remove `./app` and `./worker` export lines, add replacement type exports (Task 3D)
- Do NOT run build/test.

**Verification Agent:**
- Run `bun check` from `apps/main`
- Run `bun test unit`
- Run `bun test integration/ --max-concurrency 1`
- Fix any issues (likely broken imports elsewhere that reference deleted exports)
- DO NOT COMMIT

---

## Estimated Effort

| Task | LOC Changed | Files | Risk |
|------|------------|-------|------|
| Phase 1A: Fix oauth-helpers | ~5 | 1 | Low |
| Phase 1B: Blog re-exports | ~10 | 1 | Low |
| Phase 2: Worker rewrite | ~120 | 1 | **Medium** — most complex, must get middleware chain right |
| Phase 3: Delete + cleanup | ~30 changed, ~422 deleted | 6 | **Medium** — might surface broken imports |
| **Total** | ~165 changed, ~422 deleted | 9 | |

## Limitations

- **No integration test coverage for blog/media worker routing.** The existing integration tests test `packages/server/` (the Bun dev server), not the Cloudflare worker. The worker rewrite can only be fully verified by manual testing or deploying to CF preview.
- **Media CORS config is duplicated** from `app.ts` into the worker. If media CORS origins change, they now need to change in `worker/src/index.ts`. Consider extracting to a shared constant in the future.
- **`requestContextMiddleware`** is imported from media-server and applied in the worker. This is a runtime dependency on media-server's logging infrastructure. Acceptable for now.

## Risks & Mitigations

1. **Hono type mismatch** — Blog/media sub-apps declare `Variables` types different from the worker's `AppContext`. Hono's `.route()` is lenient about this (sub-app variables are merged), but TypeScript might complain. Mitigation: use `as any` cast if needed on `.route()` calls, or use `new Hono()` without type parameter for the sub-app mounts.

2. **Blog `authMiddleware` import chain** — After deleting `blog-server/src/middleware/auth.ts`, any file that imports from it will break. Currently only `blog-server/src/index.ts` imports it (line 4). The rewrite of `index.ts` handles this. The `require-auth.ts` file (which exports `withAuth`) does NOT import from `auth.ts` — verified.

3. **Media `app.ts` import chain** — After deleting `media-server/src/app.ts`, `media-server/src/index.ts` line 28 imports from it. The updated `index.ts` removes this import.
