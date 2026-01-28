# devpad Codebase Consolidation Plan

## Executive Summary

After auditing every package, file, and directory in the monorepo, I've identified **~4,800 lines of code and ~30 files** that can be deleted, plus significant architectural simplifications. The biggest wins come from:

1. **Eliminating the Bun-only service layer** (~2,800 LOC) — the entire non-D1 code path (server package routes/middleware + core services without `db` param + Lucia adapter) exists solely for local dev/tests but is a complete parallel implementation of what the worker already has
2. **Deleting migration-era scripts and database artifacts** (~900 LOC + 5 DB files)
3. **Consolidating duplicate route/auth definitions** between server and worker packages

### Key Architectural Finding

The codebase currently has **two complete backend implementations**:

| Component | Bun/Server Path (local dev + tests) | Worker/D1 Path (production) |
|---|---|---|
| Routes | `packages/server/src/routes/v1.ts` (1,236 LOC) | `packages/worker/src/routes/v1.ts` (721 LOC) |
| Auth Routes | `packages/server/src/routes/auth.ts` (327 LOC) | `packages/worker/src/routes/auth.ts` (225 LOC) |
| Auth Middleware | `packages/server/src/middleware/auth.ts` (189 LOC) | `packages/worker/src/middleware/auth.ts` (90 LOC) |
| Services | `packages/core/src/services/*.ts` (~1,815 LOC) | `packages/core/src/services/*.d1.ts` (~1,179 LOC) |
| Auth Logic | `core/auth/oauth.ts` + `lucia.ts` + `jwt.ts` + `keys.ts` (~378 LOC) | `core/auth/oauth-d1.ts` + `session.ts` + `jwt-web.ts` + `keys-d1.ts` (~590 LOC) |

The D1 path is the **production code path**. The Bun path is a legacy parallel implementation used only by `packages/server` for local dev and integration tests. The D1 versions are also better code — they use `Result<T,E>`, pass `db` as a parameter (testable!), and don't rely on global singletons.

---

## Prioritised Consolidation Items

### Item 1: Delete Non-D1 Core Services (Keep D1 Only)

**Impact: ~1,815 lines removed, 10 files deleted**
**Difficulty: Hard**
**Risk: Breaks integration tests and local dev server until they're migrated**

The following files in `packages/core/src/services/` are the Bun-only variants that import `db` from a global singleton (`@devpad/schema/database/server`). Their D1 counterparts (`*.d1.ts`) take `db` as a parameter and return `Result<T,E>`:

| File to DELETE | Lines | D1 Replacement |
|---|---|---|
| `services/projects.ts` | 322 | `services/projects.d1.ts` (214) |
| `services/tasks.ts` | 271 | `services/tasks.d1.ts` (217) |
| `services/scanning.ts` | 571 | `services/scanning.d1.ts` (308) |
| `services/goals.ts` | 145 | `services/goals.d1.ts` (113) |
| `services/milestones.ts` | 150 | `services/milestones.d1.ts` (114) |
| `services/github.ts` | 247 | `services/github.d1.ts` (136) |
| `services/tags.ts` | 77 | `services/tags.d1.ts` (80) |
| `services/users.ts` | 47 | `services/users.d1.ts` (31) |
| `services/action.ts` | 106 | `services/action.d1.ts` (102) |
| `services/index.ts` | partial cleanup | Remove non-D1 re-exports |

Then rename all `*.d1.ts` to `*.ts` (drop the suffix).

Also delete the non-D1 auth variants:
| File to DELETE | Lines | D1 Replacement |
|---|---|---|
| `auth/oauth.ts` | 214 | `auth/oauth-d1.ts` (220) |
| `auth/lucia.ts` | 46 | `auth/session.ts` (178) — already the D1 replacement |
| `auth/jwt.ts` | 36 | `auth/jwt-web.ts` (109) — uses Web Crypto API (works in CF Workers) |
| `auth/keys.ts` | 84 | `auth/keys-d1.ts` (83) |

**Total: ~1,815 LOC services + ~380 LOC auth = ~2,195 LOC deleted**

After this, `packages/core/src/index.ts` needs cleanup — it currently re-exports both D1 and non-D1 variants via barrel exports.

**Breaking changes**: `packages/server` routes, `packages/server` middleware, integration tests, and anything importing from `@devpad/core` directly all need updating.

---

### Item 2: Delete or Collapse `packages/server` Into a Thin Dev Harness

**Impact: ~1,750 lines removed (net after replacement), 6 files deleted/replaced**
**Difficulty: Hard (depends on Item 1)**
**Risk: Breaks local dev and integration test infrastructure**

Currently `packages/server` is a complete Bun-based Hono app with its own routes, middleware, and SSR handler (~2,049 LOC). Once Item 1 eliminates the non-D1 services, this package's routes become dead code — they reference functions that no longer exist.

**Approach**: Replace `packages/server` with a thin Bun dev harness that:
- Creates an in-memory SQLite database via `better-sqlite3`/`bun:sqlite`
- Wraps it with `drizzle-orm/bun-sqlite` but presents it as a D1-compatible interface
- Reuses `packages/worker/src/routes/v1.ts` and `packages/worker/src/routes/auth.ts` directly
- Reuses `packages/worker/src/middleware/auth.ts` directly

This eliminates:
| File to DELETE | Lines |
|---|---|
| `server/src/routes/v1.ts` | 1,236 |
| `server/src/routes/auth.ts` | 327 |
| `server/src/middleware/auth.ts` | 189 |
| `server/src/server.ts` | 258 (most of it) |
| `server/src/index.ts` | 21 |
| `server/src/local.ts` | 24 |

Replaced with a ~150 LOC dev server that wraps the worker's routes. **Net: ~1,750 LOC removed.**

Also eliminates these dependencies from `packages/server/package.json`:
- `lucia` (entire library!)
- `@lucia-auth/adapter-drizzle`
- `arctic`
- `jsonwebtoken`

---

### Item 3: Delete Migration-Era Scripts & Database Artifacts

**Impact: ~600 LOC + 5 database files (~2.3 MB) deleted**
**Difficulty: Easy**
**Risk: None — these are one-time migration tools already used**

**Files to delete:**
| File | Lines | Reason |
|---|---|---|
| `scripts/generate-d1-schema.ts` | 67 | D1 schema generation complete |
| `scripts/merge-d1-databases.ts` | 75 | DB merge complete |
| `scripts/migrate-to-d1.ts` | 86 | Migration complete |
| `scripts/verify-migration.ts` | 75 | Verification complete |
| `scripts/utils/sql-escape.ts` | ~50 | Only used by migration scripts |
| `scripts/__tests__/migration.test.ts` | ~170 | Tests for migration scripts |
| `scripts/create-test-user.ts` | 45 | Superseded by test setup |
| `scripts/build-todo-tracker.sh` | 38 | Legacy build script |
| `database/local.db` | - | 180KB dev artifact |
| `database/production.db` | - | 647KB copied prod DB |
| `database/production-2.db` | - | 668KB copied prod DB |
| `database/test-migration.db` | - | 647KB migration artifact |
| `database/tmp.db` | - | 180KB temp file |
| `test.db` (root) | - | 184KB root artifact |

**Total: ~600 LOC + ~2.3 MB of binary artifacts**

---

### Item 4: Delete `packages/schema/src/database/db.ts` and `server.ts` (Global Singleton DB)

**Impact: ~12 lines removed + eliminates architectural anti-pattern**
**Difficulty: Medium (blocked by Items 1 & 2)**
**Risk: Breaks anything still importing the global `db`**

Once Items 1 and 2 are done, nothing should import `@devpad/schema/database/server` anymore. Delete:
- `packages/schema/src/database/db.ts` (7 LOC) — the global `db` singleton
- `packages/schema/src/database/server.ts` (6 LOC) — re-exports the singleton
- Update `packages/schema/src/database/index.ts` to remove `server.ts` export

This prevents anyone from accidentally using the global singleton pattern again.

---

### Item 5: Rename D1 Files (Remove `.d1` Suffix)

**Impact: 0 lines changed (just renames), but massive DX improvement**
**Difficulty: Easy (after Item 1)**
**Risk: Low — find-and-replace import paths**

Rename all `*.d1.ts` files to just `*.ts`:
- `services/action.d1.ts` -> `services/action.ts`
- `services/github.d1.ts` -> `services/github.ts`
- `services/goals.d1.ts` -> `services/goals.ts`
- `services/milestones.d1.ts` -> `services/milestones.ts`
- `services/projects.d1.ts` -> `services/projects.ts`
- `services/scanning.d1.ts` -> `services/scanning.ts`
- `services/tags.d1.ts` -> `services/tags.ts`
- `services/tasks.d1.ts` -> `services/tasks.ts`
- `services/users.d1.ts` -> `services/users.ts`
- `auth/oauth-d1.ts` -> `auth/oauth.ts`
- `auth/keys-d1.ts` -> `auth/keys.ts`

Then update all imports in `packages/worker/`, `packages/core/`, tests.

---

### Item 6: Consolidate Verbose Debug Logging in Server Routes

**Impact: ~300 lines removed (conservative estimate)**
**Difficulty: Easy**
**Risk: None**

`packages/server/src/routes/v1.ts` contains massive blocks of debug logging, such as the PATCH `/projects` handler which is 127 lines when the worker equivalent is 37 lines. If the server routes survive Item 2, strip all the `log.projects("...")` and verbose debug middleware.

The PATCH `/projects` handler alone has:
- 25 lines of raw body reading/reconstruction middleware
- 30+ lines of log statements with emoji prefixes
- A complete manual re-validation step before the zValidator

This entire verbose pattern was clearly added for debugging and should be removed.

---

### Item 7: Clean Up `deployment/` Directory

**Impact: ~1,000 LOC deleted, 8+ files removed**
**Difficulty: Easy**
**Risk: Low — Docker deployment may be superseded by CF Workers**

Now targeting Cloudflare Workers, the Docker/VPS deployment infrastructure is likely dead:

| File | Lines | Status |
|---|---|---|
| `deployment/Dockerfile` | 94 | Dead if CF Workers is primary |
| `deployment/docker-compose.*.yml` (5 files) | 164 | Dead if CF Workers is primary |
| `deployment/plan.md` | 402 | Historical doc |
| `deployment/README.md` | 395 | Historical doc |
| `deployment/vps/setup.sh` | 341 | Dead VPS setup |
| `deployment/migrate.ts` | 18 | May still be needed |
| `deployment/production.ts` | 23 | May still be needed |
| `deployment/serverless.ts` | 15 | May still be needed |
| `deployment/.env.local` | - | Credentials file |
| `deployment/.env.*.example` (2 files) | - | Examples for dead config |

**Decision needed**: Is Docker/VPS deployment still used? If purely CF Workers now, delete everything except `deployment/serverless.ts`.

---

### Item 8: Delete `packages/core/src/utils/README.md`

**Impact: 1 file deleted**
**Difficulty: Easy**
**Risk: None**

Violates AGENTS.md rule: "NEVER proactively create documentation files (*.md)"

---

### Item 9: Clean Up Root Artifacts

**Impact: Several files deleted**
**Difficulty: Easy**
**Risk: Low**

| File | Reason |
|---|---|
| `test.db` (root, 184KB) | Test artifact, should be in `.gitignore` |
| `todo-config.json` | Legacy config for scanner, likely superseded |
| `PUBLISHING.md` | May be obsolete post-monorepo |
| `VERSIONING.md` | May be obsolete post-monorepo |
| `test-results/` | E2E artifact directory |
| `.playwright/` | E2E artifact directory |

---

### Item 10: Consolidate `packages/core` Test Files

**Impact: ~709 LOC affected (reorganization)**
**Difficulty: Easy**
**Risk: Low**

Tests are scattered inside `packages/core/src/` alongside source code:
- `core/src/auth/__tests__/jwt-web.test.ts` (150 LOC)
- `core/src/auth/__tests__/keys-d1.test.ts` (119 LOC)
- `core/src/auth/__tests__/session.test.ts` (78 LOC)
- `core/src/services/__tests__/github-fixtures.test.ts` (37 LOC)
- `core/src/services/__tests__/projects.d1.test.ts` (164 LOC)
- `core/src/services/__tests__/scanning.d1.test.ts` (161 LOC)

After Item 1, the D1 tests become the primary tests. These should be moved to a top-level `tests/unit/` directory to match the project convention.

---

### Item 11: Remove `packages/schema/src/database/unified.ts`

**Impact: ~5 LOC removed + simplification**
**Difficulty: Easy**
**Risk: Low**

`unified.ts` just re-exports blog, d1, media, and schema modules. It's a redundant barrel that adds confusion. The `index.ts` already serves as the barrel.

---

### Item 12: Audit `tests/shared/` for Dead Utilities

**Impact: ~150-270 LOC potentially removable**
**Difficulty: Medium**
**Risk: Low**

| File | Lines | Status |
|---|---|---|
| `tests/shared/base-integration-test.ts` | 152 | Check if any test actually uses this |
| `tests/shared/cleanup-manager.ts` | 119 | Check if used after setup.ts refactor |
| `tests/shared/assertions.ts` | 193 | Check usage |
| `tests/shared/mcp-test-client.ts` | 82 | Used by MCP tests |

These may be partially dead after various test infrastructure changes.

---

### Item 13: Investigate `packages/scanner` Merge Into Core

**Impact: ~304 LOC moved (not deleted)**
**Difficulty: Medium**
**Risk: Low**

`packages/scanner` (304 LOC) is a standalone package with only one consumer: `packages/core/src/services/scanning.d1.ts`. It contains a GitHub repo scanner, task parser, and diff engine. This could be inlined directly into core/services instead of being a separate package with its own `package.json`.

---

## Architecture Decision: What About blog-server and media-server?

I **deliberately did NOT include "delete blog-server/media-server"** as a consolidation item, despite the temptation. Here's why:

**blog-server (1,653 LOC)** and **media-server (8,124 LOC)** are genuine domain packages with their own:
- Business logic (services)
- Route definitions
- Platform integrations (media has 6 platform adapters)
- Auth/ownership logic specific to their domain

They're consumed by the worker's `index.ts` which mounts them as sub-routers. Moving them into `packages/core` would bloat core with unrelated domain logic. They're better left as separate packages.

**However**, if the team wants to go further in a future consolidation phase:
- `blog-server/src/services/` could move to `core/services/blog/`
- `blog-server/src/routes/` could move into `worker/src/routes/blog/`
- Same pattern for media-server

This would eliminate 2 package.json files and simplify the workspace, but it's **cosmetic**, not architectural. The current separation is clean.

---

## Phase Plan

### Phase 1: Easy Deletions (Parallel, No Dependencies)

**Estimated effort: 1-2 hours**
**Can be done independently of everything else.**

| Task | Agent | Files Touched |
|---|---|---|
| Delete migration scripts | Agent A | `scripts/generate-d1-schema.ts`, `scripts/merge-d1-databases.ts`, `scripts/migrate-to-d1.ts`, `scripts/verify-migration.ts`, `scripts/utils/sql-escape.ts`, `scripts/__tests__/migration.test.ts`, `scripts/create-test-user.ts`, `scripts/build-todo-tracker.sh` |
| Delete database artifacts | Agent B | `database/local.db`, `database/production*.db`, `database/test-migration.db`, `database/tmp.db`, `test.db` (root) |
| Delete misc artifacts | Agent C | `packages/core/src/utils/README.md`, `todo-config.json` |

-> **Verification Agent**: Run `bun test` to ensure nothing breaks.

**Lines removed: ~600 LOC + ~2.5 MB binary**

---

### Phase 2: Delete Non-D1 Service Layer (Sequential, Critical Path)

**Estimated effort: 4-6 hours**
**This is the architectural core of the consolidation. Needs careful execution.**

**APPROVAL NEEDED**: This phase eliminates the Bun-native code path. After this, local dev and tests MUST use the D1-compatible service layer with a Bun-SQLite shim. Confirm this direction before proceeding.

| Task | Agent | Description |
|---|---|---|
| 2a: Create D1-shim for Bun-SQLite | Agent A | Create a small adapter in `packages/schema/` that wraps `bun:sqlite` + drizzle to present a D1-compatible interface. This is the keystone that makes everything else work. ~80 LOC. |
| 2b: Delete non-D1 service files | Agent B (after 2a) | Delete all `*.ts` service files (non-D1), rename `*.d1.ts` -> `*.ts`, update `services/index.ts` exports |
| 2c: Delete non-D1 auth files | Agent C (after 2a) | Delete `oauth.ts`, `lucia.ts`, `jwt.ts`, `keys.ts` from `core/auth/`, rename `oauth-d1.ts` -> `oauth.ts`, `keys-d1.ts` -> `keys.ts`, update `auth/index.ts` |
| 2d: Update server package | Agent D (after 2b, 2c) | Rewrite `packages/server` to be a thin Bun harness that uses the D1-shim + worker routes. Delete old routes/middleware/server files. |
| 2e: Update integration tests | Agent E (after 2d) | Update `tests/integration/setup.ts` and all test files to use the new server harness |

-> **Verification Agent**: Run full test suite. Fix any breakage. Commit.

**Lines removed: ~3,900 LOC (services + auth + server routes/middleware)**
**Lines added: ~230 LOC (D1-shim + thin dev server)**
**Net: ~3,670 LOC removed**

---

### Phase 3: Schema & Infrastructure Cleanup (Parallel)

**Estimated effort: 1-2 hours**
**Can run after Phase 2.**

| Task | Agent | Files Touched |
|---|---|---|
| Delete `database/db.ts` + `server.ts` | Agent A | `packages/schema/src/database/db.ts`, `server.ts`, update `index.ts` |
| Delete `unified.ts` | Agent A | `packages/schema/src/database/unified.ts`, update `index.ts` |
| Move core unit tests | Agent B | Move `core/src/**/__tests__/*.test.ts` to `tests/unit/` |
| Audit `tests/shared/` | Agent C | Check usage of `base-integration-test.ts`, `cleanup-manager.ts`, `assertions.ts`; delete unused |
| Clean up verbose logging | Agent D | Strip debug logging from any surviving server routes |

-> **Verification Agent**: Run full test suite. Commit.

**Lines removed: ~500-700 LOC**

---

### Phase 4: Deployment Cleanup (Requires Decision)

**Estimated effort: 30 min**
**Blocked on: Decision about Docker/VPS deployment.**

If Docker/VPS is dead:
- Delete all of `deployment/` except `serverless.ts`
- Delete GitHub Actions workflows for Docker deployment
- **Lines removed: ~1,400 LOC**

If Docker/VPS is still used:
- Delete only `deployment/plan.md`, `deployment/README.md`, and the production DB files
- **Lines removed: ~800 LOC**

---

## Summary Table

| Phase | Lines Removed | Files Deleted | Difficulty |
|---|---|---|---|
| Phase 1: Easy Deletions | ~600 + binaries | ~14 | Easy |
| Phase 2: Kill Non-D1 Path | ~3,670 net | ~20 | Hard |
| Phase 3: Schema/Infra Cleanup | ~500-700 | ~8 | Medium |
| Phase 4: Deployment (TBD) | ~800-1,400 | ~8-15 | Easy |
| **Total** | **~5,570-6,370** | **~50-57** | |

This represents roughly **25-30% of the backend codebase** being removed while maintaining 100% feature parity. The codebase moves from two parallel implementations to one unified D1-compatible code path.

---

## Limitations & Open Questions

1. **Integration tests currently run against `packages/server` (Bun+SQLite singleton)**. Phase 2 is the riskiest phase because it changes how tests work. The D1-shim approach is the safest migration path.

2. **The scanning service (`scanning.ts`, 571 LOC) uses `child_process` and local filesystem operations** that won't work in CF Workers. The D1 version (`scanning.d1.ts`, 308 LOC) uses `@devpad/scanner` which presumably works differently. Need to verify the D1 scanning implementation is complete before deleting the Bun version.

3. **Lucia auth library** is only used by the Bun code path. The D1 path has a custom session implementation in `session.ts`. Deleting Lucia removes a significant dependency but means the custom session code must be battle-tested.

4. **The three Astro frontends share almost no code.** They have different layouts, different components, different API clients. Consolidating them into one app is possible but would be a large UX/routing refactor that doesn't remove much code — it's more of a product decision than a consolidation opportunity.

5. **`packages/scanner`** is tiny (304 LOC) and only has one consumer. It could be inlined into core but it's not a high priority.
