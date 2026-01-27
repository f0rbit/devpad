# Phase 5: Consolidate Blog + Media APIs into Unified Worker Middleware

## Executive Summary

Eliminate `blogContextMiddleware` and `mediaContextMiddleware` from the worker. The worker becomes a single Hono app with one middleware chain (`requestContext -> cors -> db -> auth -> unifiedContext`) that provides everything blog, media, and devpad routes need. Blog and media route sub-apps stop reading domain-specific Hono variables (`blogUser`, `blogContext`, `mediaAuth`, `mediaContext`) and instead receive what they need from a single unified context.

### Key Design Decision: Blog Numeric User IDs

Blog services use `userId: number` everywhere (the `blog_users.id` auto-increment PK). This is a FK in `blog_posts.author_id`, `blog_categories.owner_id`, `blog_tags`, `blog_access_keys`, etc. We **cannot** remove this in one step.

**Strategy**: Move the `ensureBlogUser` lookup **into the blog-server package** as a utility. The blog `withAuth()` helper will accept the devpad `AuthUser` (with `github_id`) and resolve the blog numeric user internally. This keeps the blog service layer unchanged and moves the mapping logic to the right package.

### Breaking Changes

- `AppVariables` loses `blogContext`, `blogUser`, `blogJwtToken`, `mediaContext`, `mediaAuth` fields
- Blog-server's `withAuth()` signature changes (reads `user` + `unifiedContext` instead of `blogUser` + `blogContext`)
- Media-server's `getAuth()` and `getContext()` read from unified variables instead of domain-specific ones
- Blog-server's `Variables` type changes
- Media-server's `Variables` type changes
- Worker entry consolidates from 3 Hono apps to 1

---

## Target Architecture

### Unified AppVariables

```typescript
// packages/worker/src/bindings.ts
export type AppVariables = {
  db: UnifiedDatabase;
  user: AuthUser;
  session: SessionData | null;
  blogContext: BlogAppContext;
  mediaContext: MediaAppContext;
  requestContext: RequestContext;
};
```

All variables are non-optional because the unified context middleware constructs them eagerly for every request. They're cheap to create (just object construction from env bindings - no async work except the blog user upsert which moves to blog-server).

### Single Middleware Chain

```
requestContextMiddleware -> corsMiddleware -> dbMiddleware -> authMiddleware -> unifiedContextMiddleware
```

### Single Hono App (worker entry)

```typescript
const app = new Hono<AppContext>();

// Global middleware
app.use("*", requestContextMiddleware());
app.use("*", corsMiddleware);
app.use("*", dbMiddleware);
app.use("*", authMiddleware);
app.use("*", unifiedContextMiddleware);

// Devpad routes
app.get("/health", ...);
app.route("/api/v0", v0Routes);
app.route("/api/auth", authRoutes);

// Blog routes (mounted under /blog prefix for blog.devpad.tools routing)
app.route("/api/blog", blogRouter);
app.route("/health", blogHealthRouter);  // blog health
app.route("/auth", blogAuthRouter);

// Media routes
app.route("/api/auth", mediaAuthRoutes);  // media OAuth
app.route("/api/v1/timeline", timelineRoutes);
app.route("/api/v1/connections", connectionRoutes);
app.route("/api/v1/credentials", credentialRoutes);
app.route("/api/v1/profiles", profileRoutes);
app.get("/api/v1/me", ...);
```

The hostname-based routing in `createUnifiedWorker` still dispatches to the correct set of routes, but all routes share the same middleware chain and Hono app instance.

---

## Detailed File Changes

### 1. `packages/worker/src/bindings.ts` (~30 LOC)

**Change**: Replace `AppVariables` with unified type. Remove `BlogUser` type (moves to blog-server). Remove all optional domain-specific fields.

```typescript
export type AppVariables = {
  db: UnifiedDatabase;
  user: AuthUser;
  session: SessionData | null;
  blogContext: BlogAppContext;
  mediaContext: MediaAppContext;
  requestContext: RequestContext;
};
```

Remove the `BlogUser` export (it's only used in blog middleware which gets deleted).

### 2. `packages/worker/src/middleware/context.ts` (NEW, ~40 LOC)

**Create**: New unified context middleware that replaces both blog and media context middleware. Constructs `BlogAppContext` and `MediaAppContext` from env bindings and sets them on the Hono context. Does NOT do blog user upsert (that moves to blog-server).

```typescript
export const unifiedContextMiddleware = createMiddleware<AppContext>(async (c, next) => {
  const env = c.env;
  const db = c.get("db");

  const blog_context = createContextFromDeps({
    blog_db: env.DB,
    blog_bucket: env.BLOG_CORPUS_BUCKET,
    devpad_db: db,
    jwt_secret: env.JWT_SECRET,
    environment: env.ENVIRONMENT,
  });
  c.set("blogContext", blog_context);

  const provider_factory = createProviderFactory(env.DB);
  const media_context = createContextFromBindings(env, provider_factory);
  c.set("mediaContext", media_context);

  return next();
});
```

### 3. `packages/worker/src/middleware/blog.ts` (DELETE)

**Delete** entirely. The `ensureBlogUser` function moves to `packages/blog-server/src/utils/blog-user.ts`.

### 4. `packages/worker/src/middleware/media.ts` (DELETE)

**Delete** entirely. Logic absorbed into unified context middleware.

### 5. `packages/worker/src/index.ts` (~120 LOC, rewrite)

**Change**: Consolidate from 3 Hono apps to 1. Single middleware chain. Hostname-based routing now dispatches path prefixes to the correct sub-routes on the same app.

Key changes:
- Remove `createDevpadApi()`, `createBlogApi()`, `createMediaApi()` 
- Create single `createApi()` that mounts all routes
- Move CORS config to global level (merge media's origin list with devpad/blog needs)
- Move `requestContextMiddleware` to global level
- The `/api/v1/me` endpoint reads `user` directly instead of `mediaAuth`
- The `/api/auth/logout` media endpoint stays as-is

### 6. `packages/blog-server/src/utils/blog-user.ts` (NEW, ~40 LOC)

**Create**: Extract `ensureBlogUser` from deleted worker middleware. This is the blog_users upsert logic.

```typescript
export type BlogUser = {
  id: number;
  github_id: number;
  username: string;
  email: string | null;
  avatar_url: string | null;
  created_at: Date;
  updated_at: Date;
};

export const ensureBlogUser = async (db: DrizzleDB, github_id: number, username: string): Promise<BlogUser | null> => {
  // upsert logic (same as current worker/middleware/blog.ts)
};
```

### 7. `packages/blog-server/src/middleware/require-auth.ts` (~35 LOC, rewrite)

**Change**: `withAuth()` no longer reads `blogUser` and `blogContext` from Hono context. Instead it reads `user` (the devpad `AuthUser`) and `blogContext` from the unified context, then calls `ensureBlogUser()` to resolve the numeric blog user ID.

```typescript
export const withAuth =
  <P extends string, I extends Input, T>(handler: AuthenticatedHandler<P, I, T>) =>
  async (c: Context<any, P, I>): Promise<T | Response> => {
    const devpad_user = c.get("user");
    const ctx = c.get("blogContext");

    if (!devpad_user) {
      return c.json({ code: "UNAUTHORIZED", message: "Authentication required" }, 401);
    }
    if (!ctx) {
      return c.json({ code: "INTERNAL_ERROR", message: "Blog context not initialized" }, 500);
    }

    const blog_user = await ensureBlogUser(ctx.db, devpad_user.github_id, devpad_user.name);
    if (!blog_user) {
      return c.json({ code: "INTERNAL_ERROR", message: "Failed to resolve blog user" }, 500);
    }

    return handler(c, blog_user, ctx);
  };
```

This means **every authenticated blog request** does a user upsert. This is fine because:
1. It's an upsert with `ON CONFLICT DO UPDATE` - idempotent and fast
2. Blog requests are low-volume (admin panel)
3. D1 handles this efficiently with the unique index on `github_id`

### 8. `packages/blog-server/src/utils/route-helpers.ts` (~15 LOC change)

**Change**: Update `Variables` type to use unified variable names.

```typescript
export type Variables = {
  user: { id: string; github_id: number; name: string; task_view: "list" | "grid" } | null;
  blogContext: AppContext;
};
```

Remove `blogUser` and `blogJwtToken` from the type.

### 9. `packages/blog-server/src/routes/auth.ts` (~10 LOC change)

**Change**: Read `user` instead of `blogUser`. The auth status endpoint needs to resolve the blog user or just return the devpad user info.

```typescript
authRouter.get("/status", async c => {
  const devpad_user = c.get("user");
  if (!devpad_user) {
    return c.json({ authenticated: false, user: null });
  }
  const ctx = c.get("blogContext");
  const blog_user = await ensureBlogUser(ctx.db, devpad_user.github_id, devpad_user.name);
  return c.json({
    authenticated: !!blog_user,
    user: blog_user ?? null,
  });
});
```

### 10. `packages/blog-server/src/routes/health.ts` (~5 LOC change)

**Change**: Read `blogContext` (same variable name, but now always present).

No change needed - already reads `blogContext`.

### 11. `packages/blog-server/src/routes/projects.ts` (~5 LOC change)

**Change**: The `blogJwtToken` access needs rethinking. Currently reads `c.get("blogJwtToken")`. 

Looking at this more carefully: the `blogJwtToken` is never actually set anywhere in the current worker middleware! The blog context middleware doesn't set it. This appears to be dead code / a feature that was never wired up. The refresh endpoint just needs a JWT token for devpad API auth - it should read from the `session` or reconstruct from the auth header.

**Resolution**: Read the JWT from the request's Authorization header directly (it's already there from the auth middleware flow). Or pass through from the unified auth context.

### 12. `packages/media-server/src/auth.ts` (~30 LOC change)

**Change**: `getAuth()` reads `user` from the unified context and maps to `AuthContext` format. Remove the `(c as any).get("mediaAuth")` fallback hack.

```typescript
export const getAuth = (c: Context): AuthContext => {
  const user = c.get("user");
  if (!user) {
    throw new Error("Auth context not found.");
  }
  return {
    user_id: user.id,
    name: user.name,
    email: null,
    image_url: null,
  };
};
```

Remove the standalone `authMiddleware` and `optionalAuthMiddleware` exports from media-server since the worker's unified auth handles this. These are now dead code.

### 13. `packages/media-server/src/utils/route-helpers.ts` (~10 LOC change)

**Change**: `getContext()` reads `mediaContext` directly (no `appContext` fallback). Update `Variables` type.

```typescript
export const getContext = (c: any): AppContext => {
  const ctx = c.get("mediaContext");
  if (!ctx) throw new Error("AppContext not set");
  return ctx;
};

export type Variables = {
  user: { id: string; name: string; github_id: number; task_view: string } | null;
  mediaContext: AppContext;
};
```

### 14. `packages/media-server/src/oauth-helpers.ts` (~10 LOC change)

**Change**: Update auth reads. The `(c as any).get("mediaAuth") ?? c.get("auth")` in `validateOAuthQueryKeyAndProfile` should use `getAuth(c)` instead.

Line 178: Replace `const auth = (c as any).get("mediaAuth") ?? c.get("auth");` with:
```typescript
const { getAuth } = await import("./auth");
const auth = (() => { try { return getAuth(c); } catch { return null; } })();
```

Or better: just read `c.get("user")` and map inline since the auth is unified.

### 15. Media route files (minimal changes)

`packages/media-server/src/routes/auth.ts`, `timeline.ts`, `connections.ts`, `credentials.ts`, `profiles.ts`:

**Change**: Update the local `Variables` type definition in each file. These all define:
```typescript
type Variables = {
  auth: AuthContext;
  appContext: AppContext;
};
```

Change to match the unified shape. However, since these files use `getAuth(c)` and `getContext(c)` helper functions that abstract the variable access, the route handlers themselves don't need changes - only the `Variables` type in the `new Hono<...>()` generic needs updating.

Actually, looking more carefully: the routes use `getAuth(c)` and `getContext(c)` which already abstract the access. The `Variables` type is only used in the Hono generic `new Hono<{ Bindings: Bindings; Variables: Variables }>()`. Since these are sub-routers mounted on the main app that has `AppContext` typing, they'll inherit the correct types. We can simplify these to just `new Hono<AppContext>()` or keep the local type but match the unified shape.

**Simplest approach**: Change the Hono generic in each route file to `new Hono<any>()` or import `AppContext` from the worker bindings. But that creates a circular dependency (media-server depending on worker). Better: define a shared type that both use.

**Best approach**: Since `getAuth()` and `getContext()` already handle the abstraction, the Hono type parameter on route files is mostly cosmetic for the route handlers that directly access `c.env`. Let's just update the local `Variables` type to remove domain-specific names.

### 16. `packages/media-server/src/index.ts` (~10 LOC change)

**Change**: Remove exports for `authMiddleware`, `optionalAuthMiddleware` since they're dead code after consolidation. Keep `requestContextMiddleware` export (still used by worker). Remove `getAuth` re-export if it's no longer needed externally.

### 17. `packages/blog-server/src/index.ts` (no change)

No changes needed - it just re-exports routers.

### 18. `packages/blog-server/src/context.ts` (no change)

No changes needed - `createContextFromDeps` is still used by the unified context middleware.

---

## Risks and Edge Cases

### 1. Blog User Upsert Per-Request (MEDIUM)
Every authenticated blog request will upsert into `blog_users`. This is fine for admin traffic but worth noting. The upsert is idempotent and the `github_id` unique index makes it fast.

### 2. `blogJwtToken` in projects.ts (LOW)
The `blogJwtToken` variable is referenced in `blog-server/src/routes/projects.ts` line 32 but never set by any middleware. This is likely dead/broken code. Plan: read JWT from the Authorization header instead.

### 3. Media CORS Origins (LOW)
Currently media has specific CORS origins. Moving to a global CORS handler means we need to include all domains. The media origins (`media.devpad.tools`, `devpad.tools`, `localhost:4321`, `localhost:3000`, `*.workers.dev`, `*.pages.dev`) are a superset - safe to apply globally.

### 4. Media `requestContextMiddleware` Applied Globally (LOW)
Currently only applied to media routes. Applying globally adds a request ID header to all responses. This is actually beneficial, not risky.

### 5. Media-Server Standalone Auth (MEDIUM)
`packages/media-server/src/auth.ts` exports `authMiddleware` and `optionalAuthMiddleware` that are used when media-server runs standalone. After consolidation these become dead code **in the worker context** but may still be needed if media-server ever runs independently. Plan: keep them in media-server but don't import/use them in the worker.

### 6. Route Prefix Conflicts (MEDIUM)
Blog uses `/auth/status`, `/auth/logout`. Media uses `/api/auth/reddit`, `/api/auth/login`, etc. Devpad uses `/api/auth/...`. In the single app, these are mounted at different prefix paths so no conflict:
- Devpad: `/api/auth/...` (worker authRoutes)
- Blog: hostname-based → `/auth/...` and `/api/blog/...`
- Media: hostname-based → `/api/auth/...` and `/api/v1/...`

The hostname-based routing in the fetch handler still ensures correct dispatching.

### 7. Blog Auth Middleware Running for All Routes (LOW)
In the unified chain, `authMiddleware` runs for all routes regardless of domain. This is already the case for blog and media (they both use `dbMiddleware` + `authMiddleware`). The unified context middleware creates both blog and media contexts for every request, which is a tiny bit wasteful but negligible (just object construction, no I/O).

---

## Task Breakdown

### Phase 1: Create New Files (parallel)
These tasks create new files and don't touch existing ones - zero merge conflict risk.

#### Task 1A: Create `packages/blog-server/src/utils/blog-user.ts` (~40 LOC)
Extract `ensureBlogUser` function and `BlogUser` type from `packages/worker/src/middleware/blog.ts`.
- Copy the `ensureBlogUser` function body
- Copy the `BlogUser` type
- Import `blog_users` from `@devpad/schema/database/blog`
- Import `eq` from `drizzle-orm`
- Import `drizzle` from `drizzle-orm/d1` (for creating the Drizzle instance from D1)
- Export both `BlogUser` type and `ensureBlogUser` function

**Wait**: Actually, the blog context already has `db: DrizzleDB` which is the drizzle instance. The current middleware creates a separate `drizzle(blog_db)` for the upsert. But the `BlogAppContext.db` is the same DB. So `ensureBlogUser` should take `DrizzleDB` directly rather than `D1Database`.

Correction: The current middleware does `const db = drizzle(blog_db)` where `blog_db = env.DB` (the raw D1 binding). The `BlogAppContext.db` is also `drizzle(deps.blog_db)` from `createContextFromDeps`. So we can have `ensureBlogUser` take `DrizzleDB` (the drizzle instance) and use it directly.

```typescript
export const ensureBlogUser = async (db: DrizzleDB, github_id: number, username: string): Promise<BlogUser | null> => {
  // Uses db (already a drizzle instance) directly
};
```

#### Task 1B: Create `packages/worker/src/middleware/context.ts` (~40 LOC)
New unified context middleware.
- Import `createContextFromDeps` from `@devpad/blog-server/context`
- Import `createContextFromBindings`, `createProviderFactory` from `@devpad/media-server`
- Import `requestContextMiddleware` from `@devpad/media-server` (or inline it)
- Create and export `unifiedContextMiddleware`
- Create and export `corsMiddleware` (extracted from current media config, made universal)

### Phase 2: Update Consumer Packages (parallel)
These tasks modify different packages - no merge conflicts between them.

#### Task 2A: Update blog-server auth & route helpers (~50 LOC changed)
Files:
- `packages/blog-server/src/middleware/require-auth.ts` - rewrite `withAuth()` to read `user` + call `ensureBlogUser`
- `packages/blog-server/src/utils/route-helpers.ts` - update `Variables` type
- `packages/blog-server/src/routes/auth.ts` - read `user` instead of `blogUser`, call `ensureBlogUser`
- `packages/blog-server/src/routes/projects.ts` - fix `blogJwtToken` to read from auth header
- `packages/blog-server/src/routes/health.ts` - no change needed (already reads `blogContext`)

#### Task 2B: Update media-server auth & route helpers (~60 LOC changed)
Files:
- `packages/media-server/src/auth.ts` - simplify `getAuth()` to read `user` from unified context
- `packages/media-server/src/utils/route-helpers.ts` - simplify `getContext()`, update `Variables`
- `packages/media-server/src/oauth-helpers.ts` - update auth reads (line 178)
- `packages/media-server/src/routes/auth.ts` - update local `Variables` type
- `packages/media-server/src/routes/timeline.ts` - update local `Variables` type
- `packages/media-server/src/routes/connections.ts` - update local `Variables` type
- `packages/media-server/src/routes/credentials.ts` - update local `Variables` type
- `packages/media-server/src/routes/profiles.ts` - update local `Variables` type
- `packages/media-server/src/index.ts` - remove dead auth middleware exports

### Phase 3: Consolidate Worker (sequential - depends on Phase 1 & 2)

#### Task 3A: Rewrite worker bindings & entry (~120 LOC)
Files:
- `packages/worker/src/bindings.ts` - new unified `AppVariables`
- `packages/worker/src/index.ts` - single Hono app with unified middleware chain
- Delete `packages/worker/src/middleware/blog.ts`
- Delete `packages/worker/src/middleware/media.ts`

### Phase 4: Verification
- Typecheck all packages
- Run integration tests
- Verify hostname-based routing still works

---

## Estimated Lines of Code

| Task | Files | LOC Changed | LOC New | LOC Deleted |
|------|-------|-------------|---------|-------------|
| 1A: Blog user utility | 1 new | 0 | ~40 | 0 |
| 1B: Unified context middleware | 1 new | 0 | ~45 | 0 |
| 2A: Blog-server consumers | 4 files | ~50 | 0 | ~15 |
| 2B: Media-server consumers | 9 files | ~60 | 0 | ~80 |
| 3A: Worker consolidation | 2 modified, 2 deleted | ~120 | 0 | ~130 |
| **Total** | **~19 files** | **~230** | **~85** | **~225** |

Net: roughly **90 fewer LOC** across the codebase.

---

## Dependency Graph

```
Phase 1A ──┐
            ├──> Phase 2A ──┐
Phase 1B ──┤                ├──> Phase 3A ──> Phase 4 (verify)
            ├──> Phase 2B ──┘
            │
            └──> (1A and 1B are independent of each other)
```

Phase 2A depends on 1A (blog-user.ts). Phase 2B depends on 1B (context.ts types). Phase 3A depends on all of Phase 2 (consumer packages must be updated before the worker wiring changes).

---

## Detailed Step-by-Step Instructions per Task

### Task 1A: Create blog-user.ts

1. Create file `packages/blog-server/src/utils/blog-user.ts`
2. Define `BlogUser` type (copy from `packages/worker/src/bindings.ts` lines 15-23)
3. Implement `ensureBlogUser(db: DrizzleDB, github_id: number, username: string): Promise<BlogUser | null>` - NOTE: this should use the DrizzleDB directly, NOT create a new drizzle instance. The function body is the same as `packages/worker/src/middleware/blog.ts` lines 8-42 BUT adapted to take `DrizzleDB` instead of `D1Database`:
   - Remove the `const db = drizzle(blog_db)` line
   - Use the `db` parameter directly
4. Export both `BlogUser` and `ensureBlogUser`

### Task 1B: Create unified context middleware

1. Create file `packages/worker/src/middleware/context.ts`
2. Import `createContextFromDeps` from `@devpad/blog-server/context`
3. Import `createContextFromBindings`, `createProviderFactory` from `@devpad/media-server`  
4. Import `createMiddleware` from `hono/factory`
5. Import `AppContext` from `../bindings.js`
6. Implement `unifiedContextMiddleware`:
   - Reads env bindings and `db` from context
   - Creates `BlogAppContext` via `createContextFromDeps`
   - Creates `MediaAppContext` via `createContextFromBindings` with `createProviderFactory`
   - Sets both on the Hono context
   - Calls `next()`
7. Export `unifiedContextMiddleware`

### Task 2A: Update blog-server consumers

1. **`packages/blog-server/src/middleware/require-auth.ts`**:
   - Add import for `ensureBlogUser` from `../utils/blog-user`
   - Change `withAuth` to:
     - Read `c.get("user")` instead of `c.get("blogUser")`
     - Read `c.get("blogContext")` (same key name)
     - Call `ensureBlogUser(ctx.db, devpad_user.github_id, devpad_user.name)` to get blog user
     - Pass blog user and ctx to handler (same signature for handlers)
   - Update the `AuthenticatedHandler` type's user parameter type import if needed

2. **`packages/blog-server/src/utils/route-helpers.ts`**:
   - Change `Variables` type: remove `blogUser`, add `user` with the devpad AuthUser shape, keep `blogContext`
   - Remove `blogJwtToken` from `Variables`

3. **`packages/blog-server/src/routes/auth.ts`**:
   - Import `ensureBlogUser` from `../utils/blog-user`
   - In `/status` handler: read `c.get("user")`, if present call `ensureBlogUser` to get blog user for response
   - The handler becomes async

4. **`packages/blog-server/src/routes/projects.ts`**:
   - Line 32: Replace `c.get("blogJwtToken")` with reading JWT from Authorization header: `const auth_header = c.req.header("Authorization"); const jwt_token = auth_header?.startsWith("Bearer jwt:") ? auth_header.slice(11) : undefined;`

### Task 2B: Update media-server consumers

1. **`packages/media-server/src/auth.ts`**:
   - Simplify `getAuth()`: read `c.get("user")` from unified context, map to `AuthContext`. If no user, throw.
   - Keep `authMiddleware` and `optionalAuthMiddleware` exports for standalone compatibility but they won't be used by the worker.
   - Remove the `(c as any).get("mediaAuth") ?? c.get("auth")` hack.

2. **`packages/media-server/src/utils/route-helpers.ts`**:
   - Simplify `getContext()`: read `c.get("mediaContext")` only (remove `appContext` fallback)
   - Update `Variables` type to match unified shape

3. **`packages/media-server/src/oauth-helpers.ts`**:
   - Line 178: Replace `const auth = (c as any).get("mediaAuth") ?? c.get("auth")` with reading `c.get("user")` and mapping to auth format inline

4. **Route files** (`auth.ts`, `timeline.ts`, `connections.ts`, `credentials.ts`, `profiles.ts`):
   - Update local `Variables` type definition in each file
   - No handler logic changes needed (they all use `getAuth(c)` and `getContext(c)` abstractions)

5. **`packages/media-server/src/index.ts`**:
   - Keep all exports as-is (standalone auth middleware may be used elsewhere)

### Task 3A: Rewrite worker

1. **`packages/worker/src/bindings.ts`**:
   - Remove `BlogUser` type
   - Remove optional `blogUser`, `blogJwtToken`, `mediaAuth` from `AppVariables`
   - Keep `blogContext` and `mediaContext` as required (non-optional)
   - Add `requestContext` if we integrate the request context middleware
   - Remove imports for `BlogAppContext`, `MediaAuthContext` types if no longer needed in this file

2. **`packages/worker/src/index.ts`**:
   - Remove imports for `blogContextMiddleware` and `mediaContextMiddleware`
   - Import `unifiedContextMiddleware` from `./middleware/context.js`
   - Import `requestContextMiddleware` from `@devpad/media-server`
   - Create single `createApi()` function that builds one Hono app
   - Apply middleware chain: `requestContext -> cors -> db -> auth -> unifiedContext`
   - Mount all routes on the single app
   - Update `createUnifiedWorker` to use single app
   - Update the `/api/v1/me` endpoint to read `user` instead of `mediaAuth`
   - Keep hostname-based dispatch in fetch handler for SSR passthrough
   - Keep `scheduled` handler as-is (it creates its own context)

3. **Delete** `packages/worker/src/middleware/blog.ts`
4. **Delete** `packages/worker/src/middleware/media.ts`

### Task 4: Verify

1. Run `bun check` (typecheck)
2. Run `make unit` (unit tests)
3. Run `make integration` (integration tests)
4. Fix any failures

---

## Architectural Notes

### Why Not Lazy Blog User Resolution?

Considered: putting a `getBlogUser()` lazy resolver on the context. Rejected because:
1. Adds complexity (lazy Promise caching)
2. Only saves one DB query for unauthenticated blog requests (which don't hit protected routes anyway)
3. The `withAuth` pattern already gates resolution behind auth check

### Why Eager Context Construction?

Both `BlogAppContext` and `MediaAppContext` are just object construction from env bindings - no I/O, no async. Creating them eagerly costs nothing. The only I/O was the blog user upsert, which now moves to `withAuth` where it belongs.

### Why Keep `blogContext` and `mediaContext` as Separate Variables?

Considered: a single `UnifiedContext` that merges everything. Rejected because:
1. Blog and media services have different `AppContext` types with different `db` fields (blog uses plain DrizzleDB, media uses DrizzleDB with schema)
2. Merging would require all consumers to change their type imports
3. Keeping them separate is the minimal diff approach

### CORS Unification

The current media CORS config allows:
- `http://localhost:4321`, `http://localhost:3000`
- `https://media.devpad.tools`, `https://devpad.tools`  
- `*.workers.dev`, `*.pages.dev`

The devpad and blog APIs currently have no CORS (same-origin only). Adding CORS globally is safe because:
1. Auth is cookie + bearer token based (CORS doesn't weaken this)
2. The allowed origins list is restrictive
3. Blog/devpad routes that don't need CORS will just ignore it

Apply CORS to `/api/*` routes only (not SSR pages).
