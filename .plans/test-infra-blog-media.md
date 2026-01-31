# Test Infrastructure: Blog/Media Integration Tests

## Executive Summary

Blog and media integration tests (33 skipped) can't run because:
1. Drizzle migrations only cover devpad tables -- blog/media tables never get created in the test DB
2. Blog/media context constructors require raw Cloudflare D1/R2 bindings -- impossible in Bun
3. Test server explicitly disables contexts (`contexts: false`)

This plan fixes all three in 4 phases, enabling the 33 skipped tests to run.

## Current State

```
Production (Cloudflare):
  D1Database ──> drizzle(d1)         ──> blogContext.db / mediaContext.db
  D1Database ──> create_cloudflare_backend({d1, r2}) ──> blogContext.corpus / mediaContext.backend
  R2Bucket   ──┘

Test (Bun):
  Database(file) ──> createBunDatabase(sqlite) ──> db (devpad only schema in migrations)
  contexts: false ──> blog/media routes return errors
```

```
Target:
  Database(file) ──> createBunDatabase(sqlite) ──> db (ALL tables via unified migrations)
  Same sqlite    ──> blogContext.db (DrizzleDB for blog)
                 ──> create_memory_backend() ──> blogContext.corpus
                 ──> mediaContext.db (DrizzleDB for media)
                 ──> create_memory_backend() ──> mediaContext.backend
  contexts: true ──> blog/media routes work
```

## Risk Assessment

- **Breaking changes**: None for production. Context creation functions get new overloads/alternatives, but existing D1/R2 paths stay intact.
- **Migration risk**: Adding blog/media tables to the migration set means the next `bun migrate` in dev will create those tables in the local devpad DB. This is fine -- `createBunDatabase` already merges all three schemas.
- **DevpadProvider D1 coupling**: `DevpadProvider` stores a raw `D1Database` and creates its own drizzle instance. This is a separate issue -- noted but NOT fixed here. Tests that trigger devpad platform fetches will still fail, but that's out of scope.

---

## Phase 0: Fix Drizzle Migrations

**Goal**: Single `drizzle.config.ts` at schema package level that references all schema files. Regenerate migrations so blog, media, and corpus_snapshots tables are included.

### Task 0.1: Create `drizzle.config.ts` in `packages/schema`
- **Files**: `packages/schema/drizzle.config.ts` (new)
- **Est. LOC**: ~15
- **Details**:
  ```ts
  import { defineConfig } from "drizzle-kit";

  export default defineConfig({
    schema: [
      "./src/database/schema.ts",
      "./src/database/blog.ts",
      "./src/database/media.ts",
    ],
    out: "./src/database/drizzle",
    dialect: "sqlite",
  });
  ```
- **Note**: `corpus_snapshots` is re-exported from `media.ts` (`export { corpus_snapshots } from "@f0rbit/corpus/schema"`), so it will be picked up automatically.
- **Dependencies**: None
- **Parallel**: Yes (standalone)

### Task 0.2: Add `drizzle-kit` as devDependency to `packages/schema`
- **Files**: `packages/schema/package.json`
- **Est. LOC**: ~2 (add devDep + schema script)
- **Details**: Add `"drizzle-kit": "^0.31.0"` to devDependencies. Add script: `"schema": "bunx drizzle-kit generate"`.
- **Dependencies**: None
- **Parallel**: Yes (with 0.1)

### Task 0.3: Regenerate migrations
- **Files**: `packages/schema/src/database/drizzle/` (new migration files)
- **Est. LOC**: ~0 (generated SQL)
- **Details**: Run `bunx drizzle-kit generate` from `packages/schema/`. This will produce a new migration file (e.g. `0004_*.sql`) containing CREATE TABLE statements for `blog_posts`, `blog_categories`, `blog_tags`, `blog_integrations`, `blog_fetch_links`, `blog_post_projects`, `media_profiles`, `media_accounts`, `media_rate_limits`, `media_account_settings`, `media_profile_filters`, `media_platform_credentials`, and `corpus_snapshots`.
- **Dependencies**: 0.1, 0.2
- **Parallel**: No (sequential after 0.1 + 0.2)

### Task 0.4: Update `apps/main/package.json` schema script
- **Files**: `apps/main/package.json`
- **Est. LOC**: ~1
- **Details**: Change the `schema` script to point at the new config: `"schema": "cd ../../packages/schema && bunx drizzle-kit generate"` (or just document that schema generation now lives in `packages/schema`). Alternatively, remove the script from `apps/main` entirely since it's now in `packages/schema`.
- **Dependencies**: 0.1
- **Parallel**: Yes (with 0.3)

### Verification 0
- Run `bun migrate` to ensure all tables get created
- Typecheck: `cd apps/main && bun check`
- Run existing integration tests to confirm no regressions
- Commit

---

## Phase 1: Decouple Context Creation from D1/R2

**Goal**: Blog and media context constructors accept pre-built `DrizzleDB` + corpus `Backend` instead of raw D1/R2. Existing D1/R2 path becomes a thin production wrapper.

### Task 1.1: Refactor `blogContext` creation
- **Files**: `packages/core/src/services/blog/context.ts`
- **Est. LOC**: ~25
- **Details**:
  - Add new function `createContext(deps: { db: DrizzleDB; backend: Backend; jwt_secret: string; environment: string }): AppContext` that builds corpus from the backend and returns the context directly.
  - Keep existing `createContextFromDeps` but rewrite it to call `createContext` internally:
    ```ts
    export const createContextFromDeps = (deps: ContextDeps): AppContext => {
      const backend = create_cloudflare_backend({ d1: deps.blog_db, r2: deps.blog_bucket });
      const db = drizzle(deps.blog_db) as DrizzleDB;
      return createContext({ db, backend, jwt_secret: deps.jwt_secret, environment: deps.environment });
    };

    export const createContext = (deps: { db: DrizzleDB; backend: Backend; jwt_secret: string; environment: string }): AppContext => {
      const corpus = create_corpus().with_backend(deps.backend).with_store(postsStoreDefinition).build();
      return { db: deps.db, corpus, jwt_secret: deps.jwt_secret, environment: deps.environment };
    };
    ```
  - Export `createContext` from the blog service barrel export.
- **Dependencies**: None (Phase 0 doesn't touch this file)
- **Parallel**: Yes (with 1.2)

### Task 1.2: Refactor `mediaContext` creation
- **Files**: `packages/core/src/services/media/bindings.ts`
- **Est. LOC**: ~20
- **Details**:
  - Add new function `createContext(deps: { db: DrizzleDB; backend: Backend; providerFactory: ProviderFactory; encryptionKey: string; env?: OAuthEnvCredentials }): AppContext` that returns the context directly.
  - Keep existing `createContextFromBindings` but rewrite it to call `createContext` internally:
    ```ts
    export const createContextFromBindings = (env: Bindings, providerFactory: ProviderFactory): AppContext =>
      createContext({
        db: drizzle(env.DB, { schema }),
        backend: create_cloudflare_backend(toCorpusBackend(env)),
        providerFactory,
        encryptionKey: env.ENCRYPTION_KEY,
        env: { REDDIT_CLIENT_ID: env.REDDIT_CLIENT_ID, ... },
      });
    ```
  - Export `createContext` from the media service barrel export.
  - Import `OAuthEnvCredentials` from `./context.ts` (or define inline).
- **Dependencies**: None
- **Parallel**: Yes (with 1.1)

### Task 1.3: Update barrel exports
- **Files**: `packages/core/src/services/blog/index.ts`, `packages/core/src/services/media/index.ts`
- **Est. LOC**: ~4
- **Details**: Export the new `createContext` functions (aliased to avoid collision if needed, e.g. `createBlogContext` / `createMediaContext`). Check existing exports to determine naming.
- **Dependencies**: 1.1, 1.2
- **Parallel**: No (after 1.1 + 1.2)

### Verification 1
- Typecheck all packages
- Run existing integration tests (should still pass -- no behavior change)
- Commit

---

## Phase 2: Enable Contexts in Test Server

**Goal**: `createBunApp` creates blog/media contexts using SQLite + `create_memory_backend()`, sets `contexts: true`.

### Task 2.1: Update `createBunApp` to inject contexts
- **Files**: `packages/worker/src/dev.ts`
- **Est. LOC**: ~40
- **Details**:
  - Import `createContext` (blog) from `@devpad/core/services/blog`
  - Import `createContext` (media) from `@devpad/core/services/media`
  - Import `create_memory_backend` from `@f0rbit/corpus`
  - Import `drizzle` for blog (plain, no schema) and media (with schema)
  - Create blog context:
    ```ts
    const blog_db = drizzle(sqlite) as BlogDrizzleDB;
    const blog_backend = create_memory_backend();
    const blog_context = createBlogContext({
      db: blog_db,
      backend: blog_backend,
      jwt_secret: "dev-jwt-secret",
      environment: "development",
    });
    ```
  - Create media context with a `defaultProviderFactory` (already exported from platforms/index.ts):
    ```ts
    const media_db = drizzle(sqlite, { schema: mediaSchema }) as MediaDrizzleDB;
    const media_backend = create_memory_backend();
    const media_context = createMediaContext({
      db: media_db,
      backend: media_backend,
      providerFactory: defaultProviderFactory,
      encryptionKey: "dev-encryption-key",
    });
    ```
  - Pass `contexts: false` still, BUT manually inject blogContext and mediaContext via middleware:
    ```ts
    app.use("*", async (c, next) => {
      c.set("blogContext", blog_context);
      c.set("mediaContext", media_context);
      await next();
    });
    ```
    OR change `createApi` call to `contexts: true` and patch the `unifiedContextMiddleware` to accept pre-built contexts. The simpler approach is to keep `contexts: false` (skipping the D1-dependent middleware) and inject contexts directly after the app is created.

    **Recommended approach**: Don't modify `createApi`'s context middleware. Instead, after creating the app with `contexts: false`, register middleware on the app that sets the blog/media context variables. This avoids touching `unifiedContextMiddleware` which is used in production.
- **Dependencies**: Phase 1 (needs `createContext` exports)
- **Parallel**: No (single task)

### Task 2.2: Update existing error-expectation tests
- **Files**: `tests/integration/blog-api-client.test.ts`, `tests/integration/media-api-client.test.ts`
- **Est. LOC**: ~30
- **Details**:
  - The tests that currently assert `result.ok === false` (lines 22-87 in blog, 22-47 in media) now need to expect success since contexts will be active.
  - Convert these "should return Result error" tests to expect `result.ok === true` with empty/valid responses.
  - These tests validate that the routes respond, not that specific data exists, so they should work with empty tables + memory backend.
- **Dependencies**: 2.1
- **Parallel**: No (needs server changes first)

### Verification 2
- Typecheck
- Run ALL integration tests (existing devpad tests must still pass, blog/media error tests should now reflect new behavior)
- Commit

---

## Phase 3: Unskip Blog/Media Integration Tests

**Goal**: Flesh out the 33 skipped tests with real assertions.

### Task 3.1: Implement blog integration tests
- **Files**: `tests/integration/blog-api-client.test.ts`
- **Est. LOC**: ~150
- **Details**:
  - Replace all `test.skip(...)` placeholders with real test implementations
  - Posts CRUD lifecycle: create, get by slug, list, list with filters, update, delete, verify deleted
  - Categories: get tree, create, update, delete
  - Blog tags: list, create post, add tags, get tags, set tags, remove tag, cleanup
  - Tokens: list, create, delete
  - Each test uses the shared API client
  - Tests run sequentially within each describe block (CRUD lifecycle depends on ordering)
- **Dependencies**: Phase 2
- **Parallel**: Yes (with 3.2)

### Task 3.2: Implement media integration tests
- **Files**: `tests/integration/media-api-client.test.ts`
- **Est. LOC**: ~100
- **Details**:
  - Replace all `test.skip(...)` placeholders with real test implementations
  - Profiles CRUD: create, get by id, list, update, delete
  - Profile filters: create profile, list filters, add filter, remove filter, cleanup
  - Connections: list (expect empty)
  - Timeline: get (expect empty or minimal response)
- **Dependencies**: Phase 2
- **Parallel**: Yes (with 3.1)

### Verification 3
- Run full test suite including blog/media tests
- Verify all 33 previously-skipped tests pass
- Commit

---

## Summary

| Phase | Tasks | Parallel? | Est. LOC | Key files |
|-------|-------|-----------|----------|-----------|
| 0 | 0.1-0.4 | 0.1+0.2 parallel, then 0.3+0.4 | ~20 + generated SQL | `packages/schema/drizzle.config.ts`, `packages/schema/package.json`, `apps/main/package.json` |
| 1 | 1.1-1.3 | 1.1+1.2 parallel, then 1.3 | ~50 | `packages/core/src/services/blog/context.ts`, `packages/core/src/services/media/bindings.ts`, barrel exports |
| 2 | 2.1-2.2 | Sequential | ~70 | `packages/worker/src/dev.ts`, test files |
| 3 | 3.1-3.2 | Parallel | ~250 | `tests/integration/blog-api-client.test.ts`, `tests/integration/media-api-client.test.ts` |

**Total estimated LOC**: ~390 (excluding generated migration SQL)

## Known Limitations / Out of Scope

- **`DevpadProvider` D1 coupling**: `packages/core/src/services/media/platforms/devpad.ts:48` stores a raw `D1Database`. Tests using the devpad platform provider in media will still fail. Fix separately.
- **`createProviderFactory` D1 coupling**: `packages/core/src/services/media/platforms/index.ts:21` takes `D1Database`. We use `defaultProviderFactory` (which skips devpad platform) for tests. Fix separately.
- **Corpus data in tests**: `create_memory_backend()` starts empty. Blog tests that write content via corpus will work (memory backend stores in-memory), but data won't persist across server restarts. This is fine for integration tests.

## DECISION NEEDED

1. **Migration strategy**: Should we delete the existing 4 migration files and regenerate from scratch (cleaner, single migration with all tables), or generate an incremental `0004_*.sql` that adds the new tables? Incremental is safer if anyone has a dev DB with existing data. Regenerating is cleaner but requires wiping dev DBs.

---

## Suggested AGENTS.md Updates

After this work lands:
- Add note: "Drizzle config lives at `packages/schema/drizzle.config.ts`. Run `bunx drizzle-kit generate` from `packages/schema/` to generate migrations."
- Add note: "Blog/media context creation uses `createContext` (accepts DrizzleDB + Backend). `createContextFromDeps` / `createContextFromBindings` are production wrappers that create D1/R2 dependencies then delegate to `createContext`."
- Add note: "Test server injects blog/media contexts with `create_memory_backend()`. `DevpadProvider` still requires D1 -- see known limitation."
- Update Repository Structure section to mention `packages/schema/drizzle.config.ts`.
