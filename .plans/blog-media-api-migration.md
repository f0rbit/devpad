# Blog & Media App API Client Migration

## Executive Summary

Migrate both `apps/blog/` and `apps/media/` from custom API wrappers to the shared `@devpad/api` client. This consolidates 3 separate HTTP client implementations (blog's `api.ts`, media's `api.ts`, and the shared `@devpad/api`) into one. Media migrates first since it already uses Result types and bearer token auth, matching the shared client's patterns closely.

## Current State

```
apps/blog/src/lib/api.ts          ─── 150 LOC, cookie auth, mixed throw/Result, SSR bypass
apps/media/src/utils/api.ts        ─── 325 LOC, bearer auth, all-Result, SSR bypass, domain sub-clients
packages/api/src/api-client.ts     ─── 637 LOC, bearer auth, all-Result, HTTP-only, namespaced
```

**Call site counts:**
- Blog: 15 SSR + 10 SolidJS + 3 inline scripts = 28 total
- Media: 4 SSR + 19 SolidJS client + 4 raw fetch + 5 domain api calls = 32 total

## Target State

```
apps/blog/src/lib/api.ts          ─── DELETED (or reduced to SSR helper ~30 LOC)
apps/media/src/utils/api.ts        ─── DELETED (or reduced to SSR helper ~30 LOC)
apps/blog/src/lib/client.ts        ─── NEW: thin wrapper creating ApiClient with cookie-extracted JWT
apps/media/src/utils/client.ts     ─── NEW: thin wrapper creating ApiClient with API key
packages/api/src/api-client.ts     ─── UPDATED: +listWithSettings, +auth.session
```

## Gaps in `@devpad/api` That Need Fixing

### 1. Missing `connections.listWithSettings` (~5 LOC)
Media uses `include_settings=true` query param. Shared client's `connections.list` doesn't support it.
**Fix:** Add `include_settings` optional param to `connections.list`, or add a `listWithSettings` method.

### 2. Missing `auth.session` endpoint (~5 LOC)
Blog calls `/api/auth/session` (3 sites). This is outside the blog namespace and the shared client has no method for it.
**Fix:** Add `auth.session()` to the shared client that calls `/auth/session` (note: auth client base URL is already configured).

### 3. Auth header format mismatch (~10 LOC)
The `HttpClient` (request.ts) always sends `Authorization: Bearer ${api_key}`. But:
- For JWT session auth, blog needs `Authorization: Bearer <jwt_token>` (extracting from cookie)
- The `headers()` method has different logic (JWT vs X-API-KEY) but `request()` always uses Bearer

The constructor's `auth_mode` field is unused in actual requests. This needs reconciling.
**Fix:** Update `HttpClient.request()` to respect auth mode -- use `Bearer <key>` for key mode, `Bearer <jwt>` for session mode (stripping the `jwt:` prefix if present).

### 4. No `credentials: "include"` support for browser requests
The shared client uses bare `fetch()` without `credentials`. Browser-side calls from blog/media need `credentials: "include"` or `"same-origin"` for cookie-based sessions.
**Fix:** Add optional `credentials` option to `HttpClient` constructor, passed through to `fetch()`.

### 5. Media's `ConnectionsWithSettingsResponse` type mismatch
Media's custom types (`ConnectionsResponse`, `ConnectionsWithSettingsResponse`) differ from shared client's `Account[]` return type. The shared client returns `Account[]` directly, but the actual API returns `{ accounts: Account[] }`.
**Investigate:** Need to verify what the actual API returns and align types.

## Decisions

### **DECISION 1: SSR Strategy** ✅ Decided: Keep thin SSR helper

The `API_HANDLER` bypass is a significant performance optimization in Cloudflare Workers (avoids HTTP roundtrip within the same worker). The shared `@devpad/api` client is fundamentally HTTP-based -- adding SSR bypass would be complex and couple it to Cloudflare.

**Decision:** Keep a minimal `ssr()` function in each app (~20-30 LOC) that handles the `API_HANDLER` bypass. This function returns raw `Response` objects -- the callers will need to parse JSON themselves (which they already do). The shared client handles all client-side calls.

### **DECISION 2: Blog auth approach** ✅ Decided: Extract JWT from cookie

Blog uses cookie-based auth. For client-side calls via the shared `@devpad/api`, we need a JWT token.

**Approach:** Create a `getClientConfig()` function that:
1. Reads the `devpad_jwt` cookie on the client side
2. Creates an `ApiClient` with `api_key: jwt_token, auth_mode: "session"`
3. The shared client sends `Authorization: Bearer <jwt>` which the API server accepts

This means blog's client-side SolidJS components will authenticate via JWT header instead of cookie. This should work since the API server accepts both `Authorization: Bearer <jwt>` and cookie-based auth.

**Risk:** Need to verify the API server accepts bare JWT tokens in Authorization header (without `jwt:` prefix).

### **DECISION 3: Inline scripts in blog** ✅ Decided: Leave as-is

The 3 inline scripts (`[slug].astro`, `versions.astro`) are vanilla JS in `<script is:inline>` tags. They can't import modules. Converting them to SolidJS components would be a separate refactor.

**Decision:** Leave inline scripts as raw `fetch()`. They're isolated, small, and work fine. Not in scope.

### **DECISION 4: Media's `ssr-auth.ts` direct DB access** ✅ Decided: Out of scope

`ssr-auth.ts` does direct D1 database queries for auth. This is orthogonal to the API client migration -- it's a serverless auth optimization, not an API call. Leave it.

### **DECISION 5: Media's mock auth for dev mode** ✅ Decided: Preserve in wrapper

Media has `isDevMode()` + `MOCK_API_KEY` for local development. The wrapper `client.ts` will check dev mode and use mock credentials if appropriate.

## Risk Assessment

1. **Auth header format**: The API server must accept `Authorization: Bearer <jwt_token>` for blog. If it only accepts cookies, blog client-side will break. **Mitigation:** Test this in Phase 1.
2. **Response shape mismatches**: Media's custom types wrap responses differently than `@devpad/api` types. **Mitigation:** Map at call sites during migration.
3. **`credentials: "include"` removal**: If any API endpoint relies on cookies being sent AND the Authorization header isn't sufficient, calls will fail. **Mitigation:** The shared client adds `credentials: "include"` via constructor option.

## Rollback Strategy

Each phase is independently revertable via git. If Phase N fails:
- Revert the phase commit
- Old custom clients remain functional
- No cascading breakage since we migrate one app at a time

---

## Phase Breakdown

### Phase 0: Shared Client Enhancements (sequential)
**Must land before any app migration.**

#### Task 0.1: Add missing methods to `@devpad/api`
- **Files:** `packages/api/src/api-client.ts`
- **Changes:**
  - Add `auth.session()` method calling `GET /auth/session`
  - Add `include_settings` param to `media.connections.list()` (or add `listWithSettings`)
- **LOC:** ~15
- **Dependencies:** None

#### Task 0.2: Add `credentials` support to `HttpClient`
- **Files:** `packages/api/src/request.ts`
- **Changes:**
  - Add optional `credentials: RequestCredentials` to constructor options
  - Pass through to `fetch()` call in `request()` method
- **LOC:** ~10
- **Dependencies:** None

#### Task 0.3: Fix auth header to respect `auth_mode`
- **Files:** `packages/api/src/request.ts`, `packages/api/src/api-client.ts`
- **Changes:**
  - Pass `auth_mode` from `ApiClient` to each `HttpClient` instance
  - In `HttpClient.request()`, use appropriate header format based on mode
  - Session mode: `Authorization: Bearer <token>` (strip `jwt:` prefix)
  - Key mode: `Authorization: Bearer <key>` (unchanged)
- **LOC:** ~20
- **Dependencies:** None

**Parallelism:** Tasks 0.1, 0.2, 0.3 touch different sections of the same files. Run **sequentially** to avoid conflicts.

→ **Verification:** typecheck all packages, run existing API client tests

---

### Phase 1: Media App Migration (parallel-safe)

Media is migrated first because:
- Already uses Result types everywhere
- Already uses bearer token auth
- Closer mapping to shared client's API surface

#### Task 1.1: Create media client wrapper
- **Files:** `apps/media/src/utils/client.ts` (NEW)
- **Changes:**
  - Export `getClient()` function that creates `ApiClient` with:
    - API key from config (or mock key in dev mode)
    - `credentials: "include"`
    - Appropriate base URL
  - Export singleton `client` for client-side usage
- **LOC:** ~30
- **Dependencies:** Phase 0

#### Task 1.2: Migrate `connections.*` call sites
- **Files:**
  - `apps/media/src/components/solid/ConnectionCard.tsx`
  - `apps/media/src/components/solid/ConnectionList.tsx`
  - `apps/media/src/components/solid/ConnectionActions.tsx`
  - `apps/media/src/components/solid/PlatformSetupForm.tsx`
  - `apps/media/src/components/solid/PlatformSettings/*.tsx` (5 files)
- **Changes:**
  - Replace `import { connections } from "../../utils/api"` with shared client import
  - Map `connections.list(id)` → `client.media.connections.list(id)`
  - Map `connections.listWithSettings(id)` → `client.media.connections.list(id, { include_settings: true })` (or new method)
  - Map `connections.create(data)` → `client.media.connections.create(data)`
  - Map `connections.delete(id)` → `client.media.connections.delete(id)`
  - Map `connections.refresh(id)` → `client.media.connections.refresh(id)`
  - Map `connections.update(id, data)` → `client.media.connections.updateStatus(id, data.is_active)`
  - Map `connections.getSettings(id)` → `client.media.connections.settings.get(id)`
  - Map `connections.updateSettings(id, s)` → `client.media.connections.settings.update(id, s)`
  - Map `connections.getRepos(id)` → `client.media.connections.repos(id)`
  - Map `connections.getSubreddits(id)` → `client.media.connections.subreddits(id)`
  - Handle response shape differences (e.g., `{ accounts: [...] }` vs `Account[]`)
- **LOC:** ~80 (mostly import/call rewrites)
- **Dependencies:** Task 1.1
- **Parallel:** YES, with Tasks 1.3, 1.4, 1.5 (no shared files)

#### Task 1.3: Migrate `profiles.*` and `api.get/post/patch/delete` call sites
- **Files:**
  - `apps/media/src/components/solid/ProfileSelector.tsx`
  - `apps/media/src/components/solid/ProfileList.tsx`
  - `apps/media/src/components/solid/Dashboard/Dashboard.tsx`
  - `apps/media/src/components/solid/TimelineList.tsx`
- **Changes:**
  - Replace `profiles.list()` → `client.media.profiles.list()`
  - Replace `profiles.get(id)` → `client.media.profiles.get(id)`
  - Replace `profiles.getTimeline(slug)` → `client.media.profiles.timeline(slug)`
  - Replace `api.get/post/patch/delete` in ProfileList → shared client methods
  - Handle response shape differences (`{ profiles: [...] }` vs `Profile[]`)
- **LOC:** ~50
- **Dependencies:** Task 1.1
- **Parallel:** YES, with Tasks 1.2, 1.4, 1.5

#### Task 1.4: Migrate `credentials.*` and raw fetch call sites
- **Files:**
  - `apps/media/src/components/solid/RedditCredentialsForm.tsx`
  - `apps/media/src/components/solid/FilterEditor.tsx`
  - `apps/media/src/components/solid/ProfileEditor.tsx`
- **Changes:**
  - Replace `credentials.get/save/delete` → `client.media.credentials.check/save/delete`
  - Replace raw `fetch(apiUrls.profiles(...))` in FilterEditor → `client.media.profiles.filters.list/add/remove`
  - Replace raw `fetch` in ProfileEditor → `client.media.profiles.create/update`
  - Replace `api.post("/credentials/reddit", ...)` in RedditCredentialsForm → `client.media.credentials.save("reddit", ...)`
- **LOC:** ~60
- **Dependencies:** Task 1.1
- **Parallel:** YES, with Tasks 1.2, 1.3, 1.5

#### Task 1.5: Update media SSR calls
- **Files:**
  - `apps/media/src/pages/dashboard/index.astro`
  - `apps/media/src/pages/connections/index.astro`
  - `apps/media/src/pages/timeline/index.astro`
- **Changes:**
  - Keep SSR helper for `API_HANDLER` bypass (extract to `apps/media/src/utils/ssr.ts`)
  - Update imports from old `api.ts` to new `ssr.ts`
  - SSR helper is a minimal function, ~20 LOC
- **LOC:** ~40
- **Dependencies:** Task 1.1
- **Parallel:** YES, with Tasks 1.2, 1.3, 1.4

#### Task 1.6: Delete old media API client
- **Files:** `apps/media/src/utils/api.ts`
- **Changes:**
  - Delete domain sub-clients (`connections`, `profiles`, `credentials`, `timeline`)
  - Delete `fetchApi`, `request`, `api.get/post/put/patch/delete`
  - Keep only type re-exports if any consumers need them (or move to `client.ts`)
  - Delete `apiUrls` (no longer needed)
  - Delete `configureApi`, `setApiKey`, `getApiKey` (replaced by shared client)
- **LOC:** -280 (deletion)
- **Dependencies:** Tasks 1.2, 1.3, 1.4, 1.5 (all consumers migrated)
- **Parallel:** NO, runs after verification that all call sites are migrated

→ **Verification:** typecheck, run media tests if any, manual smoke test

---

### Phase 2: Blog App Migration (parallel-safe)

Blog is more complex due to:
- Mixed throw/Result API (need to handle both at call sites)
- Cookie-based auth → JWT extraction
- Inline scripts staying as raw fetch

#### Task 2.1: Create blog client wrapper
- **Files:** `apps/blog/src/lib/client.ts` (NEW)
- **Changes:**
  - Export `getClient()` that creates `ApiClient` with:
    - JWT extracted from `devpad_jwt` cookie
    - `auth_mode: "session"`
    - `credentials: "same-origin"`
    - Base URL relative or absolute depending on context
  - Handle case where no JWT cookie exists (unauthenticated)
- **LOC:** ~35
- **Dependencies:** Phase 0

#### Task 2.2: Migrate blog SolidJS components (throwing API calls)
- **Files:**
  - `apps/blog/src/components/category/categories-page.tsx`
  - `apps/blog/src/components/settings/settings-page.tsx`
  - `apps/blog/src/components/post/post-editor.tsx`
  - `apps/blog/src/components/post/project-selector.tsx`
- **Changes:**
  - Replace `api.json<T>(path)` → `client.blog.categories.tree()` (Result-based, need to unwrap)
  - Replace `api.post(path, body)` → `client.blog.categories.create(body)` etc.
  - Replace `api.delete(path)` → `client.blog.categories.delete(name)` etc.
  - Replace `api.put(path, body)` → `client.blog.tokens.update(id, body)` etc.
  - Replace `api.fetch(path)` → appropriate shared client method
  - **Breaking pattern change:** These currently throw on error. Shared client returns Result. Need to either:
    - (a) Unwrap Results at call sites (add `.then(r => { if (!r.ok) throw ...; return r.value })`) -- preserves existing error handling
    - (b) Refactor error handling to use Result pattern -- cleaner but more LOC
  - **Recommendation:** Option (a) for now. Create a small `unwrap()` helper in `client.ts`.
- **LOC:** ~100
- **Dependencies:** Task 2.1
- **Parallel:** YES, with Task 2.3

#### Task 2.3: Update blog SSR calls
- **Files:**
  - `apps/blog/src/layouts/app-layout.astro`
  - `apps/blog/src/pages/index.astro`
  - `apps/blog/src/pages/posts/[slug].astro`
  - `apps/blog/src/pages/posts/[uuid]/versions.astro`
  - `apps/blog/src/pages/posts/new.astro`
  - `apps/blog/src/pages/posts/index.astro`
  - `apps/blog/src/pages/categories/index.astro`
  - `apps/blog/src/pages/settings/index.astro`
- **Changes:**
  - Extract SSR helper to `apps/blog/src/lib/ssr.ts` (~20 LOC)
  - Update all `api.ssr(path, request, {}, runtime)` → `ssr(path, request, runtime)`
  - Keep same response handling (parse JSON from Response)
- **LOC:** ~60
- **Dependencies:** Task 2.1
- **Parallel:** YES, with Task 2.2

#### Task 2.4: Delete old blog API client
- **Files:** `apps/blog/src/lib/api.ts`
- **Changes:**
  - Delete entire file (~150 LOC)
  - Update any remaining imports
- **LOC:** -150 (deletion)
- **Dependencies:** Tasks 2.2, 2.3

→ **Verification:** typecheck, run blog tests if any, manual smoke test

---

### Phase 3: Cleanup (sequential)

#### Task 3.1: Remove unused type exports from old clients
- **Files:** Various
- **Changes:**
  - Ensure no imports from deleted `api.ts` files remain
  - Move any types that were defined in `api.ts` to proper schema packages (e.g., media's `ConnectionWithSettings`, `ProfileSummary` types)
  - Clean up unused type aliases
- **LOC:** ~30
- **Dependencies:** Phases 1, 2

→ **Verification:** full typecheck, full test suite

---

## Summary

| Phase | Tasks | Estimated LOC | Parallelizable |
|-------|-------|---------------|----------------|
| 0: Shared client fixes | 3 tasks | ~45 | No (same files) |
| 1: Media migration | 6 tasks | ~260 (+deletions) | Tasks 1.2-1.5 parallel |
| 2: Blog migration | 4 tasks | ~195 (+deletions) | Tasks 2.2-2.3 parallel |
| 3: Cleanup | 1 task | ~30 | No |
| **Total** | **14 tasks** | **~530 LOC changed** | |

**Net LOC change:** Roughly -400 LOC (deleting ~480 LOC of custom clients, adding ~80 LOC of thin wrappers).

## Breaking Changes

1. **Media auth flow**: Client-side calls switch from global `setApiKey()` to per-instance `ApiClient`. Any code that calls `configureApi()` or `setApiKey()` will need updating.
2. **Response shapes**: Some shared client methods return different shapes than the custom clients (e.g., `Account[]` vs `{ accounts: Account[] }`). Call sites must adapt.
3. **Error handling in blog**: Blog's throwing methods become Result-based. The `unwrap()` helper bridges this, but error messages/shapes may differ slightly.

## Suggested AGENTS.md Updates

After this migration completes, add:

```markdown
## API Client Usage
- All apps should use `@devpad/api` for client-side API calls
- SSR calls that need `API_HANDLER` bypass use app-local `ssr.ts` helpers
- Blog auth: extracts JWT from `devpad_jwt` cookie, passes as session auth
- Media auth: uses API key from config, mock key in dev mode
- Inline scripts in blog `[slug].astro` and `versions.astro` use raw fetch (intentional)
```
