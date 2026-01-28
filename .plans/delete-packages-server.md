# Plan: Delete `packages/server` Entirely

## Executive Summary

**Recommendation: Option A — Move dev harness into `packages/worker`.** Delete `packages/server` entirely. Add a `dev.ts` entrypoint to `packages/worker` that creates a bun:sqlite Drizzle instance, wires up fake env bindings from `process.env`, and calls the *same* `createApi()` used in production.

Option B (put it in test infra) is wrong because local dev *also* needs the harness — duplicating it across `scripts/` and `tests/` defeats the purpose. Option C (keep server) is wrong because `packages/server` is now a 147-line file that duplicates the worker's route mounting, CORS config, middleware chain, and auth wiring. Every time a route or middleware changes in `packages/worker`, someone has to remember to update `packages/server` too. That's the actual problem — not the line count.

**Breaking changes:**
- `deployment/production.ts`, `deployment/serverless.ts`, `deployment/migrate.ts` — all import from `packages/server/src/server.ts`
- `tests/integration/setup.ts` — imports `createApp`, `migrateDb` from `packages/server`
- `playwright.config.ts` — references `packages/server` in webServer command
- `Dockerfile` — builds `packages/server`
- `.github/workflows/test.yml` — builds `packages/server`
- Root `package.json` — `dev:server` script references `@devpad/server`
- `scripts/test-coverage.sh`, `scripts/coverage-report.sh` — reference `packages/server`

## Analysis

### What `packages/server` actually does

Looking at `server.ts` (147 LOC), it performs exactly 4 things:

1. **Creates a bun:sqlite Drizzle instance** (~6 LOC) — `new Database(file)` → `drizzle(sqlite, { schema })`
2. **Fakes CF Worker env bindings** (~15 LOC) — reads `process.env.*`, sets `c.env` manually
3. **Mounts routes + middleware** (~20 LOC) — duplicates what `createApi()` in worker already does, but incompletely (missing blog/media routes, missing `requestContextMiddleware`, missing `unifiedContextMiddleware`)
4. **Migration helper** (~15 LOC) — bun:sqlite `migrate()` with path fallbacks

Things 1–3 are the "dev harness" concept. They belong *next to* the production code they're shimming, not in a separate package. Thing 4 is a standalone utility.

### Why the current server.ts is problematic

`packages/server/server.ts` **does not use `createApi()`** from the worker. It constructs its own Hono app from scratch:
- Its own CORS config (different from worker)
- Its own auth middleware mounting (`app.use("/api/auth/verify", authMiddleware)` — selective) vs worker's global `app.use("*", authMiddleware)`
- Only mounts `v1Routes` and `authRoutes` — misses blog routes, media routes, timeline routes, connection routes, credential routes, profile routes
- No `requestContextMiddleware`, no `unifiedContextMiddleware`

This means **integration tests are testing a different app than production**. That's the strongest argument for Option A — make tests run against the real `createApi()`.

### The R2Bucket / D1Database shim problem

The worker middleware (`context.ts`) passes `c.env.DB` (a `D1Database`) and `c.env.BLOG_CORPUS_BUCKET` (an `R2Bucket`) to blog/media context factories. In local dev / tests, these CF-specific types don't exist.

However, the existing worker tests already solve this: `BLOG_CORPUS_BUCKET: {} as any`. Since blog/media routes aren't exercised by devpad integration tests, a no-op stub is fine. The blog/media context middleware will run but produce contexts that just won't work if you actually hit those routes — which is exactly the right behavior for local devpad development.

For `DB`, we need an actual shim. The `createD1Database(c.env.DB)` middleware calls `drizzle(d1, { schema })` with a D1 binding. For bun:sqlite, we instead call `drizzle(sqlite, { schema })`. The dev harness must **replace** the `dbMiddleware` with one that provides a pre-created bun:sqlite Drizzle instance.

### The createBunDatabase function

`packages/schema/src/database/d1.ts` exports `createD1Database`. We need an equivalent `createBunDatabase` in the schema package. Currently this function exists inline in `server.ts` and `test-utils.ts` (duplicated). Canonicalizing it into `@devpad/schema/database/bun` makes both consumers clean.

## Detailed Design

### New file: `packages/schema/src/database/bun.ts` (~15 LOC)

Exports `createBunDatabase(sqlite: Database)` — the bun:sqlite equivalent of `createD1Database`.
Also exports `migrateBunDatabase(sqlite: Database, migrationsFolder: string)`.

This is the **one canonical place** that knows how to create a Drizzle instance from bun:sqlite with the unified schema, and how to run migrations against it.

### New file: `packages/worker/src/dev.ts` (~80 LOC)

The dev harness. Exports:
- `createDevApp(options)` — creates bun:sqlite db, constructs fake `Bindings`, calls worker's `createApi()` with a custom db middleware override
- `migrateDevDb(options)` — runs bun:sqlite migrations
- `startDevServer(options)` — convenience that migrates + creates app + starts `Bun.serve`

The key insight: we **cannot** just call `createApi()` and pass it a Bun request, because `createApi()` uses `c.env.DB` in `dbMiddleware`. The Hono app created by `createApi()` expects env bindings passed as the second arg to `app.fetch(request, env, ctx)`.

Hono's `app.fetch(request, env, executionContext)` passes `env` through as `c.env`. So the dev harness can:
1. Create the bun:sqlite Drizzle instance once
2. Construct a fake `Bindings` object with `DB` as a proxy/shim that `createD1Database` can consume — OR
3. **Better**: modify `createApi` to accept an optional pre-built db, bypassing `dbMiddleware`

Actually, the cleanest approach: **refactor `createApi()` to accept an optional db override**. When provided, the `dbMiddleware` skips D1 creation and uses the override directly.

Wait — even simpler. Look at how Hono works: `app.fetch(request, env, ctx)`. The `dbMiddleware` does `createD1Database(c.env.DB)`. If we pass a fake `env.DB` that, when fed to `createD1Database` → `drizzle(d1, { schema })`, produces a working db... but `drizzle-orm/d1` expects a `D1Database` interface, not a bun:sqlite `Database`.

So the actual cleanest approach: **the dev harness creates its own Hono app that reuses the worker's route mounting but replaces the db middleware**. Let me reconsider the design.

### Revised approach: Extract route registration from `createApi()`

Refactor `packages/worker/src/index.ts`:

```
// Extract route mounting into a reusable function
export const registerRoutes = (app: Hono<AppContext>) => { ... }

// createApi() = middleware chain + registerRoutes()
export const createApi = () => {
  const app = new Hono<AppContext>();
  app.use("*", requestContextMiddleware());
  app.use("/api/*", cors({...}));
  app.use("*", dbMiddleware);
  app.use("*", authMiddleware);
  app.use("*", unifiedContextMiddleware);
  app.get("/health", ...);
  registerRoutes(app);
  return app;
}
```

Then `dev.ts` does:

```
export const createDevApp = (options) => {
  const app = new Hono<AppContext>();
  // Same middleware chain, but with bun db middleware instead
  app.use("*", requestContextMiddleware());
  app.use("/api/*", cors({...}));
  app.use("*", bunDbMiddleware(db));    // <-- the only difference
  app.use("*", authMiddleware);
  app.use("*", devContextMiddleware);   // no-op stubs for blog/media
  app.get("/health", ...);
  registerRoutes(app);
  return app;
}
```

This is still duplicating the middleware chain. Let me think of something cleaner.

### Final approach: `createApi` accepts a middleware override map

Actually, the simplest and most maintainable approach:

**`createApi()` accepts an optional `db` parameter.** If provided, the `dbMiddleware` is skipped and the provided db is set directly. This is a 3-line change to `createApi()` and keeps everything in one place.

```typescript
type ApiOptions = {
  db?: UnifiedDatabase;
};

const createApi = (options?: ApiOptions) => {
  const app = new Hono<AppContext>();
  // ...middleware...
  if (options?.db) {
    app.use("*", async (c, next) => { c.set("db", options.db!); await next(); });
  } else {
    app.use("*", dbMiddleware);
  }
  // ...rest unchanged...
};
```

For the `unifiedContextMiddleware`, it'll fail to create valid blog/media contexts from fake env bindings. That's fine — those routes won't be hit in local dev. But to avoid runtime errors on *every* request (since it's `app.use("*")`), we need the middleware to handle the case where `env.DB` / `env.BLOG_CORPUS_BUCKET` are stubs.

Actually wait — if we're passing env bindings as `app.fetch(req, env, ctx)`, the `unifiedContextMiddleware` will get `env.DB` as whatever we pass. If we pass `{} as any` for `BLOG_CORPUS_BUCKET`, the `createContextFromDeps` call will fail when it tries to use that bucket.

**Solution:** Make `unifiedContextMiddleware` fail gracefully, OR have `createApi` accept a flag to skip it, OR have the dev harness pass the db through env bindings.

Simplest: **`createApi` accepts `{ db?: UnifiedDatabase; skipContextMiddleware?: boolean }`**. In dev/test mode, blog/media context is not needed. This keeps the production path untouched.

Actually, even simpler and more correct: let's not overthink this. The dev harness will call `api.fetch(request, fakeEnv)` where `fakeEnv` includes stub values. The `unifiedContextMiddleware` will *try* to create contexts from these stubs. If we make the stubs minimally correct (pass the bun:sqlite db as `DB`, pass `{} as any` for buckets), then:
- `dbMiddleware` calls `createD1Database(c.env.DB)` — but `c.env.DB` is a bun:sqlite `Database`, not a `D1Database`

This won't work. `drizzle-orm/d1` and `drizzle-orm/bun-sqlite` are different drivers.

**So we do need the db override parameter on `createApi()`**. And for the context middleware, we need either:
1. A try/catch wrapper (against our style), or
2. A skip flag, or
3. Lazy context creation (only create when a blog/media route is hit)

Option 3 is actually the best long-term design. But for this plan, option 2 (`skipContextMiddleware`) is simplest and most explicit.

### Final Design

#### `packages/schema/src/database/bun.ts` (NEW, ~20 LOC)

```typescript
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as blogSchema from "./blog.js";
import * as mediaSchema from "./media.js";
import * as devpadSchema from "./schema.js";
import type { UnifiedDatabase } from "./d1.js";

export const createBunDatabase = (sqlite: Database): UnifiedDatabase =>
  drizzle(sqlite, {
    schema: { ...devpadSchema, ...blogSchema, ...mediaSchema },
  }) as unknown as UnifiedDatabase;

export const migrateBunDatabase = (sqlite: Database, migrationsFolder: string): void => {
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder });
};
```

Note: the `as unknown as UnifiedDatabase` cast is safe because both drivers produce SQLite-dialect Drizzle instances with the same schema. The query builder calls are identical at runtime.

#### `packages/worker/src/dev.ts` (NEW, ~85 LOC)

```typescript
import { Database } from "bun:sqlite";
import { createBunDatabase, migrateBunDatabase } from "@devpad/schema/database/bun";
import type { UnifiedDatabase } from "@devpad/schema/database/d1";
import type { Bindings } from "@devpad/schema/bindings";

type DevOptions = {
  database_file: string;
  port?: number;
  cors_origins?: string[];
  migration_paths?: string[];
};

const DEFAULT_MIGRATION_PATHS = [
  "./packages/schema/src/database/drizzle",
  "./packages/schema/dist/database/drizzle",
  "../schema/src/database/drizzle",
  "../schema/dist/database/drizzle",
];

export function migrateDevDb(options: { database_file: string; migration_paths?: string[] }): void {
  const sqlite = new Database(options.database_file);
  const paths = options.migration_paths ?? DEFAULT_MIGRATION_PATHS;

  for (const p of paths) {
    try {
      migrateBunDatabase(sqlite, p);
      sqlite.close();
      return;
    } catch {}
  }

  sqlite.close();
  throw new Error("Migrations failed - no valid migration path found");
}

function createFakeBindings(overrides?: Partial<Bindings>): Bindings {
  return {
    DB: {} as any,
    BLOG_CORPUS_BUCKET: {} as any,
    MEDIA_CORPUS_BUCKET: {} as any,
    ENVIRONMENT: process.env.ENVIRONMENT ?? "development",
    API_URL: process.env.API_URL ?? "http://localhost:3001",
    FRONTEND_URL: process.env.FRONTEND_URL ?? "http://localhost:4321",
    GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID ?? "",
    GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET ?? "",
    JWT_SECRET: process.env.JWT_SECRET ?? "dev-jwt-secret",
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ?? "dev-encryption-key",
    REDDIT_CLIENT_ID: process.env.REDDIT_CLIENT_ID ?? "",
    REDDIT_CLIENT_SECRET: process.env.REDDIT_CLIENT_SECRET ?? "",
    TWITTER_CLIENT_ID: process.env.TWITTER_CLIENT_ID ?? "",
    TWITTER_CLIENT_SECRET: process.env.TWITTER_CLIENT_SECRET ?? "",
    ...overrides,
  };
}

export function createDevApp(options: DevOptions) {
  // import createApi lazily to avoid issues
  const { createApi } = require("./index.js");

  const sqlite = new Database(options.database_file);
  const db = createBunDatabase(sqlite);
  const bindings = createFakeBindings({ ENVIRONMENT: "development" });

  const api = createApi({ db });  // pass pre-built db to skip dbMiddleware
  // Return a fetch function that passes fake bindings
  return {
    app: api,
    fetch: (request: Request) => api.fetch(request, bindings, { waitUntil: () => {}, passThroughOnException: () => {} }),
    db,
  };
}

export async function startDevServer(options: DevOptions): Promise<void> {
  migrateDevDb(options);
  const { fetch } = createDevApp(options);
  const port = options.port ?? 3001;
  Bun.serve({ port, fetch });
}
```

Wait — I realize the `createApi({ db })` approach requires modifying `createApi()` to accept options. Let me formalize this.

#### Modified: `packages/worker/src/index.ts` (~125 LOC, +10 LOC)

Add an `ApiOptions` parameter to `createApi()`:

```typescript
type ApiOptions = {
  db?: UnifiedDatabase;
};

const createApi = (options?: ApiOptions) => {
  const app = new Hono<AppContext>();

  app.use("*", requestContextMiddleware());
  app.use("/api/*", cors({...}));

  if (options?.db) {
    app.use("*", async (c, next) => {
      c.set("db", options.db!);
      await next();
    });
  } else {
    app.use("*", dbMiddleware);
  }

  app.use("*", authMiddleware);
  app.use("*", unifiedContextMiddleware);  // will fail for blog/media routes with stubs, that's fine

  // ... rest unchanged
};
```

Actually there's a problem: `unifiedContextMiddleware` runs on every request and calls `createContextFromDeps` which calls `drizzle(deps.blog_db)` with a fake DB. That `drizzle()` call from `drizzle-orm/d1` might throw if given `{} as any`.

Let me check what happens when `drizzle-orm/d1`'s `drizzle()` receives a fake object. It likely just stores the reference and only fails when a query is executed. So the middleware will successfully set contexts — they'll just be broken if you try to *use* them for actual DB queries. That's acceptable for local dev.

However, `create_cloudflare_backend` might do something with R2 eagerly. Let me look...

Actually, looking at the context middleware more carefully — it runs on `*` (every request). If `createContextFromDeps` throws synchronously on a fake R2 bucket, every single request will fail. We need to handle this.

**Safest approach:** Add a `skipContextMiddleware` flag OR wrap context middleware in dev.ts to catch and ignore errors. But we don't like try/catch.

**Better approach:** Make `createApi` accept `{ db?, contexts?: boolean }`. When `contexts` is `false`, skip `unifiedContextMiddleware`. Default is `true`.

```typescript
type ApiOptions = {
  db?: UnifiedDatabase;
  contexts?: boolean;  // default true
};
```

This is clean, explicit, and doesn't introduce try/catch.

## Final File-by-File Plan

### Files to CREATE

| File | Est. LOC | Purpose |
|------|----------|---------|
| `packages/schema/src/database/bun.ts` | 20 | Canonical bun:sqlite database creation + migration |
| `packages/worker/src/dev.ts` | 75 | Dev harness: createDevApp, migrateDevDb, startDevServer |
| `packages/worker/src/local.ts` | 15 | Local dev entrypoint (replaces `packages/server/src/local.ts`) |

### Files to MODIFY

| File | Change | Est. LOC delta |
|------|--------|----------------|
| `packages/worker/src/index.ts` | Add `ApiOptions` to `createApi()`, export it | +10 |
| `packages/worker/package.json` | Add `"./dev"` export, add `bun:sqlite` dev dep, add `dev` script | +8 |
| `packages/schema/package.json` | Add `"./database/bun"` export | +1 |
| `tests/integration/setup.ts` | Import from `@devpad/worker/dev` instead of `packages/server` | ~0 (same LOC, different imports) |
| `tests/shared/test-utils.ts` | Use `createBunDatabase` / `migrateBunDatabase` from `@devpad/schema/database/bun` | -15 |
| `deployment/production.ts` | Import from `@devpad/worker/dev` | ~0 |
| `deployment/serverless.ts` | Import from `@devpad/worker/dev` | ~0 |
| `deployment/migrate.ts` | Import from `@devpad/worker/dev` | ~0 |
| `deployment/Dockerfile` | Remove `packages/server` build step, update CMD | -3 |
| `.github/workflows/test.yml` | Remove `packages/server` build step | -1 |
| `package.json` (root) | Update `dev:server` script | ~0 |
| `playwright.config.ts` | Update webServer command to use `packages/worker` | ~0 |
| `scripts/test-coverage.sh` | Replace `packages/server` references with `packages/worker` | ~0 |
| `scripts/coverage-report.sh` | Replace `packages/server` references with `packages/worker` | ~0 |
| `scripts/e2e-check.sh` | Update dist directory check | ~0 |
| `AGENTS.md` | Update references to server.log location | ~0 |

### Files to DELETE

| File | LOC removed |
|------|-------------|
| `packages/server/src/server.ts` | -147 |
| `packages/server/src/index.ts` | -3 |
| `packages/server/src/local.ts` | -17 |
| `packages/server/package.json` | -23 |
| `packages/server/tsconfig.json` | -28 |
| `packages/server/` (entire directory) | **-218 total** |

### Net LOC change

| | LOC |
|---|-----|
| Created | +110 |
| Deleted | -218 |
| Modified | ~0 net |
| **Net** | **~-108** |

## Detailed Implementation

### `packages/schema/src/database/bun.ts`

Canonical bun:sqlite utilities. Eliminates duplication between `server.ts` (line 46-51) and `test-utils.ts` (line 31-32).

- `createBunDatabase(sqlite: Database): UnifiedDatabase` — creates Drizzle instance with unified schema
- `migrateBunDatabase(sqlite: Database, migrationsFolder: string): void` — runs migrations

The `UnifiedDatabase` type cast (`as unknown as UnifiedDatabase`) is safe because both `drizzle-orm/bun-sqlite` and `drizzle-orm/d1` produce functionally identical query builders for the SQLite dialect. The type difference is only in the driver layer.

### `packages/worker/src/index.ts` changes

1. Add `ApiOptions` type: `{ db?: UnifiedDatabase; contexts?: boolean }`
2. `createApi(options?: ApiOptions)` — conditionally uses provided `db` or `dbMiddleware`, conditionally applies `unifiedContextMiddleware`
3. Export `createApi` (currently it's module-scoped `const`, only used by `createUnifiedWorker`)

The `contexts` flag defaults to `true`. When `false`, blog/media context middleware is skipped. This is fine because:
- Local dev only exercises devpad routes (v1, auth)
- Integration tests only exercise devpad routes
- Blog/media have their own test suites

### `packages/worker/src/dev.ts`

Three exports:
- `migrateDevDb(options: { database_file, migration_paths? })` — opens bun:sqlite, tries migration paths, closes
- `createDevApp(options: DevOptions)` — creates bun:sqlite db via `@devpad/schema/database/bun`, constructs fake `Bindings` from process.env, calls `createApi({ db, contexts: false })`, returns `{ app, fetch, db }`
- `startDevServer(options: DevOptions)` — convenience: migrate + createDevApp + Bun.serve

The `fetch` wrapper calls `app.fetch(request, fakeBindings, fakeExecutionContext)` so Hono middleware sees `c.env.*` populated correctly.

### `packages/worker/src/local.ts`

Minimal entrypoint (~15 LOC):
```
import { startDevServer } from "./dev.js";
startDevServer({
  database_file: process.env.DATABASE_FILE!,
  port: Number(process.env.PORT) || 3001,
});
```

### `tests/integration/setup.ts` changes

Replace:
```typescript
const { createApp, migrateDb } = await import("../../packages/server/src/server.js");
migrateDb({ databaseFile, migrationPaths: [...] });
const app = createApp({ ... });
Bun.serve({ port: 3001, fetch: app.fetch });
```

With:
```typescript
const { createDevApp, migrateDevDb } = await import("../../packages/worker/src/dev.js");
migrateDevDb({ database_file: databaseFile, migration_paths: [...] });
const { fetch } = createDevApp({ database_file: databaseFile, port: 3001 });
Bun.serve({ port: 3001, fetch });
```

The test setup becomes simpler because `createDevApp` handles db creation + fake bindings internally.

### `tests/shared/test-utils.ts` changes

Replace inline `Database` + `drizzle` calls with:
```typescript
import { createBunDatabase, migrateBunDatabase } from "@devpad/schema/database/bun";
```

The `setupTestDatabase` and `createTestUser` functions become shorter.

### `deployment/` changes

All three files switch imports:
```typescript
// Before
import { startServer } from "../packages/server/src/server";
// After
import { startDevServer } from "../packages/worker/src/dev";
```

Note: `deployment/production.ts` currently uses `startServer` for Docker/VPS deployment (Bun-native, not CF Worker). This is a legitimate use case that the dev harness also serves. The naming "dev" is slightly misleading for production use — but the function does the same thing: run the worker app against bun:sqlite. We could name it `startBunServer` instead of `startDevServer` to be more accurate.

**Decision: name it `startBunServer`, `createBunApp`, `migrateBunDb`.** The "Bun" prefix distinguishes it from the CF Worker path without implying it's dev-only.

### Dockerfile changes

Remove:
```dockerfile
WORKDIR /app/packages/server
RUN bun run build
```

Update CMD to reference new entrypoint (or keep `deployment/production.ts` which now imports from worker/dev).

### Root package.json changes

```json
"dev:server": "DATABASE_FILE=../../database/local.db bun run --filter=@devpad/worker dev"
```

(The `packages/worker/package.json` gets a new `"dev"` script: `"dev": "bun --watch src/local.ts"`)

## Limitations

1. **Blog/media routes are unreachable in local dev.** They were already unreachable in `packages/server` (it didn't mount them), so this is not a regression. If someone needs to test blog/media locally, they'd use `wrangler dev`.

2. **The `UnifiedDatabase` type cast is a lie.** The bun:sqlite Drizzle instance is not truly the same type as the D1 Drizzle instance. They're runtime-compatible for all Drizzle query builder operations, but TypeScript doesn't know that. We cast through `unknown`. If Drizzle ever diverges the APIs, this breaks at runtime. This is an acceptable risk given both target SQLite.

3. **`deployment/production.ts` and `deployment/serverless.ts` are arguably dead code.** If devpad is deployed as a CF Worker, these Docker/VPS deployment scripts may never run. But they're not in scope for this plan — we're just re-pointing their imports.

## Task Breakdown

### Phase 1: Foundation (sequential — shared dependency)

**APPROVAL REQUIRED** — This phase changes `createApi()`'s signature, which is the architectural linchpin.

| Task | Est. LOC | Description |
|------|----------|-------------|
| 1.1 | 20 | Create `packages/schema/src/database/bun.ts` + add export to schema's `package.json` |
| 1.2 | 10 | Modify `packages/worker/src/index.ts`: add `ApiOptions` param to `createApi()`, export it |

These must be done sequentially (1.1 before 1.2) because 1.2 depends on the type from 1.1.

### Phase 2: New dev harness (parallel after Phase 1)

| Task | Est. LOC | Description |
|------|----------|-------------|
| 2.1 | 75 | Create `packages/worker/src/dev.ts` with `createBunApp`, `migrateBunDb`, `startBunServer` |
| 2.2 | 15 | Create `packages/worker/src/local.ts` |
| 2.3 | 8 | Update `packages/worker/package.json` (exports, scripts, dev deps) |

2.1, 2.2, 2.3 can be done in parallel (different files, no conflicts).

### Phase 3: Consumer migration (parallel after Phase 2)

| Task | Est. LOC | Description |
|------|----------|-------------|
| 3.1 | ~0 | Update `tests/integration/setup.ts` to import from `@devpad/worker/dev` |
| 3.2 | -15 | Simplify `tests/shared/test-utils.ts` to use `@devpad/schema/database/bun` |
| 3.3 | ~0 | Update `deployment/production.ts` import |
| 3.4 | ~0 | Update `deployment/serverless.ts` import |
| 3.5 | ~0 | Update `deployment/migrate.ts` import |
| 3.6 | ~0 | Update `playwright.config.ts` webServer command |
| 3.7 | ~0 | Update root `package.json` dev:server script |

All parallel — each touches a different file.

### Phase 4: Cleanup (parallel after Phase 3)

| Task | Est. LOC | Description |
|------|----------|-------------|
| 4.1 | -218 | Delete `packages/server/` directory entirely |
| 4.2 | -1 | Remove `packages/server` build step from `.github/workflows/test.yml` |
| 4.3 | -3 | Remove `packages/server` build step from `Dockerfile` |
| 4.4 | ~0 | Update `scripts/test-coverage.sh` and `scripts/coverage-report.sh` |
| 4.5 | ~0 | Update `scripts/e2e-check.sh` |
| 4.6 | ~0 | Update `AGENTS.md` server.log references |

All parallel — independent file changes.

### Phase 5: Verification

Single agent:
- Run `bun install` (workspace resolution without `@devpad/server`)
- Run type check
- Run unit tests
- Run integration tests
- Verify local dev server starts (`DATABASE_FILE=database/local.db bun run dev:server`)

## Summary of Naming Decisions

| Old (packages/server) | New (packages/worker/dev) | Rationale |
|------------------------|---------------------------|-----------|
| `createApp(options)` | `createBunApp(options)` | Explicit about runtime, not just "an app" |
| `migrateDb(options)` | `migrateBunDb(options)` | Matches above |
| `startServer(options)` | `startBunServer(options)` | Matches above |
| `createServerExport(options)` | `createBunApp(options).fetch` | No need for separate export — just use the fetch function |
| `ServerOptions` | `BunServerOptions` | Matches above |
| `DatabaseOptions` | (folded into `BunServerOptions`) | Simplification |
