# devpad Cloudflare Cleanup & Consolidation Plan

## Executive Summary

With the Docker/VPS deployment path killed and the dual-backend eliminated, significant dead weight remains in the codebase: deployment artifacts targeting Docker/VPS, GitHub workflows for Docker CI/CD, stale dependency declarations (lucia, oslo, arctic, old drizzle-orm versions), scripts for Docker-era publishing/versioning, and a broken `tsc` build chain in `packages/core`. This plan cleans all of that up, fixes the drizzle version mismatch, switches `packages/core` to source exports (matching the pattern already used by scanner, blog-server, media-server, and worker), and removes 15+ dead files.

**Risk Level:** Low-Medium. All changes are deletions or dependency fixes. The one structural change (core's exports pointing to `src/` instead of `dist/`) matches an established pattern in the monorepo.

**Breaking Changes:**
- `packages/core` will no longer ship `dist/` or `tsc`-compiled output. Consumers that import from `dist/` paths will break. Within this monorepo, all consumers already resolve through Bun's bundler which handles `.ts` files natively. External consumers (npm publish) of `@devpad/core` don't exist (it's `private` — wait, it's NOT marked private). **Decision needed:** Should `@devpad/core` be marked private? It has no `publishConfig` and is an internal package. If it should be publishable, we need a different strategy. Analysis below assumes it's internal-only.
- `apps/main` middleware uses `lucia` just for `verifyRequestOrigin()`. That's a ~10 line utility function we'll inline to kill the dependency.

---

## Analysis by Area

### 1. Dead Deployment Artifacts (HIGH PRIORITY)

**What:** The entire `deployment/` directory targets Docker/VPS. VPS is dead. Cloudflare deployment uses `wrangler.toml` + `scripts/build-unified.ts`.

| File | Status | Action |
|------|--------|--------|
| `deployment/Dockerfile` | Dead (Docker/VPS) | DELETE |
| `deployment/docker-compose.yml` | Dead | DELETE |
| `deployment/docker-compose.local.yml` | Dead | DELETE |
| `deployment/docker-compose.staging.yml` | Dead | DELETE |
| `deployment/docker-compose.production.yml` | Dead | DELETE |
| `deployment/docker-compose.test.yml` | Dead | DELETE |
| `deployment/vps/setup.sh` | Dead | DELETE |
| `deployment/production.ts` | Dead (starts Bun server, not CF Worker) | DELETE |
| `deployment/serverless.ts` | Dead (exports Bun app, not CF Worker) | DELETE |
| `deployment/migrate.ts` | **Keep-ish** — migrates bun:sqlite for local dev. Could move to `scripts/` or `packages/worker/` | MOVE to `scripts/migrate-local.ts` |
| `deployment/plan.md` | Dead (Docker/VPS CI/CD plan) | DELETE |
| `deployment/README.md` | Dead | DELETE |
| `deployment/.env.staging.example` | Dead (VPS env vars) | DELETE |
| `deployment/.env.production.example` | Dead (VPS env vars) | DELETE |
| `deployment/.env.local` | Dead | DELETE |

**Result:** Delete `deployment/` entirely except `migrate.ts` which moves to `scripts/`.

### 2. Dead GitHub Workflows (HIGH PRIORITY)

| Workflow | Status | Action |
|----------|--------|--------|
| `test.yml` | Partially alive — runs tests. But builds Go `todo-tracker` binary that nothing needs. Also references `cd packages/core && bun run build` which is broken. | UPDATE |
| `deploy-staging.yml` | Dead (Docker/VPS SSH deploy) | DELETE |
| `deploy-production.yml` | Dead (Docker/VPS SSH deploy) | DELETE |
| `docker-test.yml` | Dead (Docker build test) | DELETE |
| `publish-packages.yml` | Partially alive — publishes api/cli/mcp to npm. But references `packages/server` (deleted), `packages/app` (renamed to `apps/main`), `cd ../core && bun run build` (broken). | UPDATE |
| `version-manager.yml` | Partially alive — still tracks versions for publish. References Docker image tags. | UPDATE |

**For `test.yml`:**
- Remove the "Setup test environment" step that clones/builds `todo-tracker` (no source code references it)
- Remove `cd packages/core && bun run build` step (or fix it — see drizzle fix below)
- Keep the test runner steps
- Remove Go build dependency

**For `publish-packages.yml`:**
- Remove references to `packages/server` and `packages/app`
- Fix build order to match current package names
- Remove Docker image tag references from version-manager

**For `version-manager.yml`:**
- Remove Docker image tag output (`image-tag`)
- Simplify to just npm version management

### 3. Dependency Cleanup (HIGH PRIORITY)

#### `packages/core/package.json`
| Dependency | Status | Action |
|-----------|--------|--------|
| `lucia: ^3.1.1` | Dead — Lucia auth was deleted. Not imported anywhere in core. | REMOVE |
| `oslo: ^1.2.0` | Dead — not imported anywhere. | REMOVE |
| `arctic: ^1.5.0` | Dead — not imported anywhere (OAuth rewritten to use raw fetch). | REMOVE |
| `drizzle-orm: ^0.30.6` | **Wrong version** — schema uses `^0.44.7`. This is why `tsc` fails. | UPDATE to `^0.44.7` |

#### `packages/worker/package.json`
| Dependency | Status | Action |
|-----------|--------|--------|
| `drizzle-orm: ^0.30.6` | Wrong version — should match schema's `^0.44.7` | UPDATE to `^0.44.7` |

#### `packages/media-server/package.json`
| Dependency | Status | Action |
|-----------|--------|--------|
| `drizzle-orm: ^0.30.6` | Wrong version — should match schema's `^0.44.7` | UPDATE to `^0.44.7` |

#### `apps/main/package.json`
| Dependency | Status | Action |
|-----------|--------|--------|
| `lucia: ^3.1.1` | Used ONLY for `verifyRequestOrigin` in middleware.ts | REMOVE after inlining the function |
| `oslo: ^1.2.0` | Dead — not imported anywhere | REMOVE |
| `arctic: ^1.5.0` | Dead — not imported anywhere | REMOVE |

#### Lucia `verifyRequestOrigin` replacement
The function from lucia is simple CSRF origin checking. The Astro middleware (`apps/main/src/middleware.ts`) imports it. We'll inline a 5-line version:
```typescript
function verifyRequestOrigin(origin: string, allowedOrigins: string[]): boolean {
  if (!origin) return false;
  const originHost = new URL(origin).host;
  return allowedOrigins.some(allowed => new URL(`http://${allowed}`).host === originHost);
}
```

### 4. Core Package Export Fix (HIGH PRIORITY)

**Problem:** `packages/core/package.json` points all exports at `dist/` which doesn't exist and can't be rebuilt due to drizzle version mismatch (now fixable). But even after fixing, maintaining a `tsc` build step for core is unnecessary overhead.

**Current state:**
- `packages/scanner` — exports from `src/` directly. Works fine.
- `packages/blog-server` — exports from `src/` directly. Works fine.
- `packages/media-server` — exports from `src/` directly. Works fine.
- `packages/worker` — exports from `src/` directly. Works fine.
- `packages/core` — exports from `dist/`. Broken. Requires `tsc` build step.

**Solution:** Switch `packages/core` to source exports, matching the pattern used by 4 other packages. All consumers within this monorepo use Bun which resolves `.ts` files natively.

**Consideration:** Is `@devpad/core` published to npm? Looking at its `package.json`:
- NOT marked `private: true`
- Has `files: ["dist"]`, `publishConfig` is absent
- Has `license: "MIT"` and `author`
- But `publish-packages.yml` only publishes `api`, `cli`, `mcp`

**Decision:** Mark `@devpad/core` as `private: true` (it's not published) and switch exports to `src/`. Remove `build`, `build:watch`, and `clean` scripts. Delete `tsconfig.json` (or keep it for editor type checking — prefer keeping it with `noEmit: true`).

### 5. Root package.json Script Cleanup (MEDIUM PRIORITY)

| Script | Status | Action |
|--------|--------|--------|
| `build:docker` | Dead | DELETE |
| `docker:*` (all 5) | Dead | DELETE |
| `e2e:docker` | Dead (relies on Docker compose) | DELETE |
| `e2e:staging` | Dead (relies on VPS staging) | DELETE |  
| `e2e:production` | Dead | DELETE |
| `deploy:production` | Dead (runs deployment/production.ts) | DELETE |
| `deploy:serverless` | Dead (runs deployment/serverless.ts) | DELETE |
| `deploy:migrate` | Barely alive — move to local dev script | UPDATE |
| `build:worker` | Alive — builds unified CF worker | KEEP |
| `dev`, `dev:server`, `dev:all` | Alive | KEEP |
| `test:*` | Alive | KEEP |
| `clean:all` | Fix — references packages/*/dist patterns | KEEP (still useful) |

### 6. Scripts Cleanup (MEDIUM PRIORITY)

| Script | Status | Action |
|--------|--------|--------|
| `scripts/build-unified.ts` | Alive — CF Worker build | KEEP |
| `scripts/test-coverage.sh` | Alive — but references `cd packages/core && bun run build` | UPDATE (remove that step) |
| `scripts/coverage-report.sh` | Alive | KEEP |
| `scripts/e2e-check.sh` | Dead (checks Docker, Docker Compose, VPS) | DELETE |
| `scripts/e2e-test.sh` | Dead (Docker/VPS test runner) | DELETE |
| `scripts/prepare-publish.js` | Alive — npm publish prep for api/cli/mcp | KEEP |
| `scripts/sync-versions.js` | Partially dead — references `packages/app` and `packages/server` | UPDATE |
| `scripts/init-versions-branch.sh` | Alive — version branch setup | KEEP |

### 7. Package Consolidation Analysis (LOW PRIORITY — OUT OF SCOPE)

**Question: Should `packages/scanner` (304 LOC) merge into `packages/core`?**

Analysis: Scanner is only imported by `packages/core/src/services/scanning.ts` and listed as a dependency in `packages/worker/package.json` (but NOT imported from worker source). The worker dep is stale.

Verdict: **Yes, merge later.** But this is a refactoring task, not a cleanup task. Low priority. For now, just remove the stale `@devpad/scanner` dependency from `packages/worker/package.json`.

**Question: Should `packages/blog-server` (1653 LOC) or `packages/media-server` (8124 LOC) merge into `packages/worker`?**

Verdict: **No.** They're substantial packages with clear separation of concerns. blog-server and media-server provide routes/services that the worker composes. Merging them would create a massive worker package with no benefit. The current composition pattern (`worker` imports from `blog-server` and `media-server`) is clean.

### 8. Test Utilities (NOT DEAD — NO ACTION)

Initial suspicion was that `base-integration-test.ts`, `cleanup-manager.ts`, and `assertions.ts` were dead. Analysis shows:
- `base-integration-test.ts` — imported by 9 integration test files
- `cleanup-manager.ts` — imported by `base-integration-test.ts` and 1 test file directly
- `assertions.ts` — imported by 6 integration test files
- `mcp-test-client.ts` — imported by 2 MCP test files

**All alive. No action needed.**

### 9. Other Cleanup Items (MEDIUM)

- `readme.md` references `./scripts/build-todo-tracker.sh` — that script was already deleted. Update readme.
- `deployment/plan.md` — VPS-era CI/CD plan. Delete with the rest of `deployment/`.
- `packages/worker/package.json` has stale `@devpad/scanner: "workspace:*"` — scanner is not imported from worker source. Remove.

---

## Task Breakdown

### Phase 1: Delete Dead Deployment & Docker Artifacts (parallel)
**All deletions, zero risk of breaking anything.**

| Task | Agent | Files Affected | Est. LOC Changed |
|------|-------|----------------|-----------------|
| 1A: Delete `deployment/` directory entirely | Agent A | 15 files deleted | -600 |
| 1B: Delete dead GitHub workflows | Agent B | 3 files deleted (`deploy-staging.yml`, `deploy-production.yml`, `docker-test.yml`) | -760 |
| 1C: Delete dead scripts | Agent C | 2 files deleted (`e2e-check.sh`, `e2e-test.sh`) | -200 |
| 1D: Clean root `package.json` scripts | Agent D | Remove 12 dead scripts (docker/e2e/deploy) | -20 |

**Verification:** Run `bun test unit` and `bun test integration/` — everything should still pass since nothing alive depended on these files.

### Phase 2: Fix Dependencies & Core Exports (sequential — touches many files)
**This is the critical architectural fix. Must be done atomically.**

| Task | Agent | Files Affected | Est. LOC Changed |
|------|-------|----------------|-----------------|
| 2A: Fix drizzle-orm versions to `^0.44.7` in core, worker, media-server `package.json` | Agent A | 3 files | ~6 |
| 2B: Remove dead deps (lucia, oslo, arctic) from core & apps/main `package.json` | Agent A | 2 files | ~6 |
| 2C: Inline `verifyRequestOrigin` in `apps/main/src/middleware.ts`, remove lucia import | Agent A | 1 file | ~10 |
| 2D: Switch `packages/core` exports from `dist/` to `src/`, mark private, update tsconfig | Agent A | 2 files (`package.json`, `tsconfig.json`) | ~30 |
| 2E: Remove stale `@devpad/scanner` dep from `packages/worker/package.json` | Agent A | 1 file | ~1 |
| 2F: Run `bun install` to update lockfile | Agent A | 1 file | auto |

**Why sequential:** All of these changes are interrelated (dep versions affect resolution, export paths affect imports, lockfile must be regenerated after all dep changes). Single agent is safest.

**Verification:** Run `bun install`, `bun test unit`, `bun test integration/` — all must pass.

### Phase 3: Update Surviving Workflows & Scripts (parallel)
**Fixes references in CI/CD and scripts to match current reality.**

| Task | Agent | Files Affected | Est. LOC Changed |
|------|-------|----------------|-----------------|
| 3A: Update `test.yml` — remove todo-tracker build step, fix build order (remove core build or make it work) | Agent A | 1 file | ~15 |
| 3B: Update `publish-packages.yml` — fix build order, remove server/app refs | Agent B | 1 file | ~10 |
| 3C: Update `version-manager.yml` — remove Docker image tag output | Agent C | 1 file | ~5 |
| 3D: Update `scripts/sync-versions.js` — remove refs to `packages/app` and `packages/server` | Agent D | 1 file | ~5 |
| 3E: Update `scripts/test-coverage.sh` — remove `cd packages/core && bun run build` step | Agent E | 1 file | ~3 |
| 3F: Update `readme.md` — remove todo-tracker reference | Agent F | 1 file | ~2 |

**Verification:** Ensure workflows are valid YAML, scripts execute without errors, tests pass.

### Phase 4: Move migrate script (quick cleanup)

| Task | Agent | Files Affected | Est. LOC Changed |
|------|-------|----------------|-----------------|
| 4A: Move `deployment/migrate.ts` logic to `scripts/migrate-local.ts`, update root `package.json` script | Agent A | 2 files | ~5 |

**Note:** Phase 4 only matters if `deployment/` wasn't fully deleted in Phase 1. If migrate.ts content is still needed, move it first. If it's truly dead (CF uses D1 migrations, not Bun sqlite migrations for prod), just delete it with the rest.

**Actually, re-evaluating:** `deployment/migrate.ts` calls `migrateBunDb()` from `packages/worker/src/dev.ts`. This is useful for local dev database setup. The `startBunServer()` function in dev.ts already calls `migrateBunDb()` automatically. So this script is redundant — migration already happens on local server start. **DELETE with the rest.**

---

## Summary of Changes

| Category | Files Deleted | Files Modified | Net LOC |
|----------|--------------|----------------|---------|
| Deployment | 15 | 0 | -600 |
| Workflows | 3 | 3 | -700 |
| Scripts | 2 | 3 | -190 |
| Dependencies | 0 | 5 | -10 |
| Core exports | 0 | 2 | -15 |
| Root config | 0 | 2 | -15 |
| **Total** | **20** | **15** | **~-1530** |

## Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Core export change breaks something | Medium | All consumers use Bun which handles .ts imports. Pattern already proven by 4 packages. Run full test suite. |
| Drizzle version bump breaks runtime | Low | Root already has `^0.44.7` and Bun resolves to it anyway. Tests already pass with it. This just makes tsc happy. |
| Removing lucia from apps/main breaks CSRF | Low | Inlining the function with identical logic. The function is trivial. |
| Workflows break after edits | Low | YAML syntax validation. The test workflow runs on every push — will self-verify. |

## Approval Needed

**Phase 2 (dependency & export changes)** is the structurally significant change. The rest are safe deletions. Please confirm:

1. `@devpad/core` should be marked `private: true` and NOT published to npm
2. Core exports should point to `src/*.ts` instead of `dist/*.js`  
3. The `verifyRequestOrigin` inline replacement approach is acceptable
4. OK to delete ALL of `deployment/` including the migrate script (since migration auto-runs on dev server start)

## Future Considerations (Out of Scope)

These are NOT part of this plan but worth noting:

- **Merge scanner into core** — 304 LOC, only one consumer. Would simplify the dependency graph.
- **Create `deploy.yml` for Cloudflare** — Replace deleted Docker deploy workflows with a `wrangler deploy` workflow.
- **E2E test strategy** — Currently E2E tests target Docker/staging VPS. Need new strategy for Cloudflare preview deployments.
- **`packages/cli` publishability** — Still references `@devpad/schema: "workspace:*"` which is not published. The publish workflow handles this but it's brittle.
