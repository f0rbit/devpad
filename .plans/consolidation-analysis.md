# devpad Consolidation Analysis

## Executive Summary

After thorough analysis of the codebase, I've identified **9 concrete consolidation opportunities** ranging from quick wins to medium-effort refactors. The biggest wins come from:

1. **Merging `packages/scanner` into `packages/core`** (only consumer, 304 LOC)
2. **Eliminating duplicated auth middleware** in `media-server/src/auth.ts` (120 LOC of redundant auth logic)
3. **Unifying the `Variables` type** duplicated 7+ times across route files
4. **Deleting dead code**: unused blog health router, unused loggers, duplicate `cookieConfig`
5. **Consolidating error-to-response mapping** (3 parallel implementations)

Total estimated removal: ~800-1000 lines of duplication/dead code.

**Breaking changes**: Items 2 and 5 touch the auth and route boundary between packages. These require careful testing but don't affect any published APIs.

---

## Findings

### 1. Merge `packages/scanner` into `packages/core/src/services/`

**What**: `packages/scanner` is a standalone package (5 files, ~304 LOC) with a single consumer: `packages/core/src/services/scanning.ts` (line 1: `import { ... } from "@devpad/scanner"`). No other package imports `@devpad/scanner`. Its only dependency is `@f0rbit/corpus`.

**Files involved**:
- `packages/scanner/src/types.ts` (47 lines)
- `packages/scanner/src/parser.ts` (59 lines)
- `packages/scanner/src/diff.ts` (72 lines)
- `packages/scanner/src/github.ts` (126 lines)
- `packages/scanner/src/index.ts` (5 lines)
- `packages/scanner/package.json`
- `packages/scanner/tsconfig.json`

**Solution**: Move all scanner source files into `packages/core/src/services/scanner/` and update the one import in `scanning.ts`. Delete `packages/scanner/` entirely. Remove the workspace dependency from `packages/core/package.json`.

**Effort**: Small (~30 min)
**Risk**: Low - single consumer, purely internal
**LOC removed**: ~20 (package boilerplate) + eliminates a whole package
**Dependencies**: None

---

### 2. Eliminate Duplicate Auth Middleware in `media-server/src/auth.ts`

**What**: `media-server/src/auth.ts` (120 LOC) reimplements the exact same auth logic that already lives in `packages/worker/src/middleware/auth.ts` (90 LOC). Both do:
- JWT verification via `@devpad/core/auth`
- Session cookie validation via `getSessionCookieName()`
- API key validation via `keys.getUserByApiKey()`

The worker auth middleware already runs on ALL requests (line 65 of `index.ts`: `app.use("*", authMiddleware)`), setting `c.get("user")` for every route. The media-server routes already read from `c.get("user")` via `getAuth()` (auth.ts line 30-41). So the media-server auth middleware is redundant - the worker middleware already populated `user`.

**Key difference**: media-server's `authMiddleware` returns 401 if no auth found (hard require), while the worker middleware sets null and continues. But the media routes use `getAuth()` which throws if no user - functionally the same as returning 401.

The `optionalAuthMiddleware` in media-server is also redundant since the worker already does optional auth on all routes.

**Files involved**:
- `packages/media-server/src/auth.ts` (120 LOC) - **DELETE entirely**
- `packages/media-server/src/index.ts` - remove auth exports
- Every media route file imports `getAuth` from `../auth` - change to read from `c.get("user")` directly or use worker's `requireAuth`

**BUT WAIT**: Looking more carefully, `getAuth()` returns an `AuthContext` type with `{ user_id, name, email, image_url, jwt_token }`, while `c.get("user")` returns `{ id, github_id, name, task_view }`. The media routes use `auth.user_id` (mapping from `user.id`). So the adapter function `getAuth()` still has value as a thin mapper. 

**Revised solution**: 
- Delete `authMiddleware` and `optionalAuthMiddleware` from media-server (they're redundant with the worker's)
- Keep `getAuth()` as a thin adapter that reads `c.get("user")` and maps to `AuthContext` shape
- Remove the duplicated `createD1Database()` call in media-server auth (it creates its OWN db instance on line 44, wasting the one already in context)

**Effort**: Small-Medium (~1 hour)
**Risk**: Medium - touches auth path, needs integration test verification
**LOC removed**: ~80 lines
**Dependencies**: None

---

### 3. Unify the `Variables` Type (Duplicated 7+ Times)

**What**: The Hono `Variables` type is defined identically in 7+ places:

- `packages/worker/src/bindings.ts` line 14 (`AppVariables`)
- `packages/blog-server/src/utils/route-helpers.ts` line 7
- `packages/media-server/src/utils/route-helpers.ts` line 13
- `packages/media-server/src/routes/auth.ts` line 9
- `packages/media-server/src/routes/connections.ts` line 12
- `packages/media-server/src/routes/timeline.ts` line 9
- `packages/media-server/src/routes/profiles.ts` line 11
- `packages/media-server/src/routes/credentials.ts` line 16
- `packages/media-server/src/oauth-helpers.ts` line 11

All define essentially: `{ user: { id: string; github_id: number; name: string; task_view: string } | null; [context]: AppContext }`.

**Solution**: Export a single `AuthUser` type from `packages/worker/src/bindings.ts` (already exists on line 7) and have all route files import from there. For the media-specific `Variables` type (which adds `mediaContext`), it can extend the base.

**Effort**: Small (~30 min)
**Risk**: Low - type-only change
**LOC removed**: ~40 lines of repeated type definitions
**Dependencies**: None

---

### 4. Duplicate `cookieConfig` Function

**What**: The `cookieConfig` function is defined identically in two files:
- `packages/worker/src/middleware/auth.ts` line 11
- `packages/worker/src/routes/auth.ts` line 25

Both return `{ secure, domain, same_site }` based on `ENVIRONMENT`.

**Solution**: Extract to a shared utility in `packages/worker/src/` (e.g., `utils.ts`) or into `packages/core/src/auth/` since it's auth-related.

**Effort**: Trivial (~10 min)
**Risk**: None
**LOC removed**: ~8 lines
**Dependencies**: None

---

### 5. Consolidate Error-to-Response Mapping (3 Parallel Implementations)

**What**: Three separate error-to-HTTP-response mapping systems exist:

1. **`packages/media-server/src/utils/route-helpers.ts`** (99 LOC): `handleResult()`, `handleResultWith()`, `handleResultNoContent()` + `ERROR_MAPPINGS` + `mapServiceErrorToResponse()`
2. **`packages/blog-server/src/utils/errors.ts`** (55 LOC): `errorMap.response()` + `ERROR_MAPPINGS`
3. **`packages/blog-server/src/utils/route-helpers.ts`** (40 LOC): `response.result()`, `response.with()`, `response.empty()`
4. **`packages/media-server/src/http-errors.ts`** (27 LOC): `badRequest()`, `unauthorized()`, `notFound()`, etc.

Plus, `packages/worker/src/routes/v1.ts` has its own inline error handling pattern (e.g., `if (result.error.kind === "not_found") return c.json(null, 404)`).

All do the same thing: map a `Result<T, ServiceError>` to an HTTP response.

**Solution**: Create a shared `packages/worker/src/utils/response.ts` that exports unified `handleResult`, `handleResultWith`, `handleResultNoContent` functions. Both blog-server and media-server route-helpers can become thin re-exports. The worker v1 routes can also adopt this pattern instead of inline if/else.

**Effort**: Medium (~2 hours)
**Risk**: Low - the implementations are already almost identical
**LOC removed**: ~100 lines
**Dependencies**: Should do after #3 (Variables unification)

---

### 6. Dead/Unused Code

#### 6a. Blog Health Router - Imported but Never Mounted

**What**: `packages/worker/src/index.ts` line 1 imports `healthRouter as blogHealthRouter` but it's **never used** - the variable `blogHealthRouter` doesn't appear anywhere else in the file. The worker has its own `/health` endpoint on line 70.

**Solution**: Remove the import.
**Effort**: Trivial
**LOC removed**: 1 import

#### 6b. Blog Auth Router - Likely Dead

**What**: `packages/blog-server/src/routes/auth.ts` exports `authRouter` with `/status` and `/logout` endpoints. This router is exported from `packages/blog-server/src/index.ts` but is NOT imported or mounted in `packages/worker/src/index.ts`. The worker has its own auth routes. This entire file appears unused.

**Solution**: Verify no other consumer, then delete.
**Effort**: Small
**Risk**: Low - verify first
**LOC removed**: ~34 lines

#### 6c. `packages/core/src/utils/logger.ts` (259 LOC) + `client-logger.ts` (233 LOC) - Barely Used

**What**: `logger.ts` exports a `log` object with category-based logging. It's re-exported from `packages/core/src/index.ts` but **no file in `packages/` imports it**. `client-logger.ts` is only imported by `apps/main/src/utils/api-client.ts`. The entire logging system is 492 LOC with essentially 1 consumer.

Meanwhile, `packages/media-server/src/logger.ts` (44 LOC) has its own simpler `createLogger` function that IS used throughout media-server.

**Solution**: 
- Delete `packages/core/src/utils/logger.ts` (259 LOC) - completely unused in packages
- Keep `client-logger.ts` only if the apps/main consumer actually uses it in production (worth checking)
- The media-server logger is fine as-is

**Effort**: Small (~20 min)
**Risk**: Low - verify apps/main usage first
**LOC removed**: ~259-492 lines

#### 6d. `packages/core/src/data/` - Empty Directory

**What**: `packages/core/package.json` exports `"./data": "./src/data/index.ts"` but the glob found NO files under `packages/core/src/data/`. The directory is either empty or doesn't exist.

**Solution**: Remove the export entry from package.json.
**Effort**: Trivial
**LOC removed**: 1 line

#### 6e. `packages/media-server/src/config.ts` - Appears Unused

**What**: `config.ts` (60 LOC) exports `configureMedia`, `getConfig`, `configureFromEnv`. Let me check if these are actually consumed...

**Checking**: The functions use a mutable singleton pattern (`let currentConfig`) which is an anti-pattern for Cloudflare Workers (no persistent state between requests).

**Solution**: Verify consumers. If unused or only used in dead code, delete.
**Effort**: Small
**Risk**: Low
**LOC removed**: ~60

---

### 7. `packages/core/src/utils/test-user.ts` - Consider Moving to Tests

**What**: `test-user.ts` (51 LOC) defines `TEST_USER`, `TEST_SESSION`, `shouldInjectTestUser()` etc. It's exported from the main `packages/core/src/index.ts`. This is test-only code living in production code.

**Solution**: Move to `tests/shared/` where the other test utilities live. Remove export from core's index.

**Effort**: Small
**Risk**: Low - check if any non-test code imports it
**LOC removed from prod**: 51 lines

---

### 8. `packages/media-server/src/db.ts` - Tiny Redundant File

**What**: `db.ts` is 9 lines that just wraps `drizzle(d1, { schema })`. Meanwhile, `packages/media-server/src/bindings.ts` line 28 does the exact same thing: `drizzle(env.DB, { schema })`. The `Database` type could come from the drizzle inference directly.

**Solution**: Inline into `bindings.ts` or keep as-is since it's so small. Low priority.
**Effort**: Trivial
**Risk**: Low
**LOC removed**: ~5

---

### 9. `packages/media-server/src/utils.ts` Re-exports Entire `@f0rbit/corpus`

**What**: `utils.ts` (187 LOC) re-exports ALL of `@f0rbit/corpus` (lines 1-18) plus adds local utilities like `secrets`, `date`, encoding, etc. Every file in media-server imports from `./utils` instead of directly from `@f0rbit/corpus`.

This is a barrel re-export pattern that doesn't add value - just adds indirection. The crypto/encoding utilities in `utils.ts` (lines 52-163) are the only unique code.

**Solution**: Not critical, but if touching this package, consider:
- Have files import `@f0rbit/corpus` directly
- Keep only the unique utilities (secrets, date, encoding) in a more descriptive file like `crypto.ts`

**Effort**: Medium (many import changes)
**Risk**: Low
**Dependencies**: Do as part of any larger media-server refactor

---

## Priority Matrix

| # | Finding | Effort | Risk | LOC Saved | Priority |
|---|---------|--------|------|-----------|----------|
| 1 | Merge scanner into core | Small | Low | ~20 + 1 package | **HIGH** |
| 6a | Remove unused blogHealthRouter import | Trivial | None | 1 | **HIGH** |
| 6d | Remove dead data export from core | Trivial | None | 1 | **HIGH** |
| 4 | Dedupe cookieConfig | Trivial | None | 8 | **HIGH** |
| 6c | Delete unused core logger.ts | Small | Low | 259-492 | **HIGH** |
| 2 | Eliminate media-server auth duplication | Small-Med | Medium | 80 | **HIGH** |
| 3 | Unify Variables type | Small | Low | 40 | **MEDIUM** |
| 6b | Delete dead blog auth router | Small | Low | 34 | **MEDIUM** |
| 7 | Move test-user.ts to tests/ | Small | Low | 51 | **MEDIUM** |
| 5 | Consolidate error-response mapping | Medium | Low | 100 | **MEDIUM** |
| 9 | Clean up media-server utils re-exports | Medium | Low | - | **LOW** |
| 8 | Inline db.ts | Trivial | Low | 5 | **LOW** |
| 6e | Delete config.ts if unused | Small | Low | 60 | **LOW** |

---

## Implementation Phases

### Phase 1: Trivial Deletions & Quick Wins (Parallel)

No merge conflicts between these tasks. All touch different files.

**Agent A: Scanner merge into core**
- Move `packages/scanner/src/*.ts` to `packages/core/src/services/scanner/`
- Update `packages/core/src/services/scanning.ts` import from `@devpad/scanner` to `./scanner/index.js`
- Remove `@devpad/scanner` from `packages/core/package.json` dependencies
- Delete `packages/scanner/` entirely
- Est: 50 LOC changed

**Agent B: Dead code cleanup in worker + core**
- Remove unused `blogHealthRouter` import from `packages/worker/src/index.ts` line 1
- Remove `"./data": "./src/data/index.ts"` from `packages/core/package.json` exports
- Extract `cookieConfig` into `packages/worker/src/utils.ts`, update imports in `middleware/auth.ts` and `routes/auth.ts`
- Est: 30 LOC changed

**Agent C: Logger cleanup**
- Delete `packages/core/src/utils/logger.ts` (259 LOC)
- Remove `export * from "./utils/logger.js"` from `packages/core/src/index.ts`
- Check and update `apps/main/src/utils/api-client.ts` if it imports from `@devpad/core/logger` (yes it does - need to inline or simplify the import, the export path `"./logger": "./src/utils/client-logger.ts"` in core's package.json still works since client-logger.ts is a separate file)
- Est: 5 LOC changed, 259 LOC deleted

**Agent D: Delete dead blog routes**
- Verify `authRouter` from `packages/blog-server/src/routes/auth.ts` has no consumers in worker
- If confirmed dead: delete `packages/blog-server/src/routes/auth.ts`
- Remove export from `packages/blog-server/src/index.ts`
- Verify blog health router: already confirmed unused in worker, but keep the export since blog-server is its own package
- Est: 40 LOC deleted

**Verification Agent**: Run typecheck + all tests. Commit.

---

### Phase 2: Auth & Type Unification (Sequential)

These changes touch overlapping concerns. Best done with coordination.

**Agent A: Eliminate media-server auth duplication**
- In `packages/media-server/src/auth.ts`:
  - Delete `authMiddleware` (lines 43-88)
  - Delete `optionalAuthMiddleware` (lines 91-119)
  - Rewrite `getAuth()` to read from `c.get("user")` instead of `c.get("auth")`
  - Update `AuthContext` type to match what worker provides or keep as adapter
- In `packages/media-server/src/index.ts`: remove `authMiddleware`/`optionalAuthMiddleware` exports
- Update any route files that import `authMiddleware` from `../auth` (they should use worker's middleware)
- Est: 80 LOC deleted, 20 LOC changed

**Agent B: Unify Variables type** (can run in parallel with A since different files)
- Export `AuthUser` type from `packages/worker/src/bindings.ts` (already exists)
- In each media-server route file, replace local `type Variables = { ... }` with import from worker bindings or a shared type
- In blog-server route-helpers, same treatment
- Est: 40 LOC deleted, 10 LOC changed

**Verification Agent**: Run typecheck + all tests. Commit.

---

### Phase 3: Error Response Consolidation (Optional, Lower Priority)

**Agent A: Create unified response helpers**
- Create `packages/worker/src/utils/response.ts` with `handleResult`, `handleResultWith`, `handleResultNoContent`
- These should accept any `Result<T, E>` where `E` has a `kind` field
- Create a unified `ERROR_MAPPINGS` that covers all error kinds from core, blog-server, and media-server

**Agent B: Update consumers**
- Update `packages/media-server/src/utils/route-helpers.ts` to re-export from worker utils
- Update `packages/blog-server/src/utils/route-helpers.ts` to re-export from worker utils
- Delete `packages/blog-server/src/utils/errors.ts` (absorbed into shared)
- Delete `packages/media-server/src/http-errors.ts` (absorbed into shared)

**Verification Agent**: Run typecheck + all tests. Commit.

---

### Phase 4: Housekeeping (Optional)

**Agent A: Move test-user.ts**
- Move `packages/core/src/utils/test-user.ts` to `tests/shared/test-user.ts`
- Update any imports (check worker tests, core tests)
- Remove export from `packages/core/src/index.ts`

**Agent B: Media-server config.ts audit**
- Check if `configureMedia`, `getConfig`, `configureFromEnv` are called anywhere
- If unused, delete `packages/media-server/src/config.ts`

**Verification Agent**: Run typecheck + all tests. Commit.

---

## What I Explicitly Did NOT Recommend

1. **Merging blog-server/media-server INTO worker**: These packages have well-defined boundaries (services + routes). They export Hono routers which the worker mounts. This is a clean architecture. Merging them would just make the worker package enormous without clear benefit.

2. **Frontend consolidation**: The 3 Astro apps are fundamentally different UIs. Without reading all their component code (which is out of scope), there's no obvious shared component extraction that would save meaningful effort.

3. **Merging blog-server/media-server services into core**: The blog and media services operate on completely different database tables with different schemas. They don't share business logic. Forcing them into core would just make core a dumping ground.

4. **TypeScript config consolidation**: Each package needs its own tsconfig for correct module resolution. A shared base tsconfig would add complexity for minimal benefit.

5. **Restructuring the media-server utils.ts barrel**: While it's not ideal, changing every import in media-server (50+ files) for a cosmetic improvement isn't worth the churn.
