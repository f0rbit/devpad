# Phase 6: Route Consolidation — Everything Under `/api/v1`, Unified `/api/auth`

## Executive Summary

The current route structure is fragmented across `/api/v0`, `/api/blog`, `/blog/auth`, `/blog/health`, `/api/media/auth`, and `/api/v1` — a residue of merging three standalone projects. This plan consolidates ALL API routes under `/api/v1` and ALL auth under `/api/auth`, eliminates redundant endpoints (blog health, blog auth redirects, overlapping project endpoints), and updates all three frontends + packages to use the new paths.

### Breaking Changes

- **`/api/v0/*`** → **`/api/v1/*`** — devpad API client, CLI, MCP, frontend all reference `/api/v0`
- **`/api/blog/*`** → **`/api/v1/blog/*`** — blog frontend references `/api/blog`
- **`/api/media/auth/*`** → **`/api/auth/platforms/*`** — media OAuth redirect URLs in Reddit/Twitter/GitHub developer consoles MUST be updated
- **`/blog/auth/*`** and **`/blog/health`** — deleted entirely
- Blog Astro frontend auth pages (`/auth/login`, `/auth/callback`, `/auth/logout`) — will redirect to devpad auth directly
- Media Astro frontend auth links (`/media/api/auth/login`, `/media/api/auth/logout`) — will use new paths
- `packages/api` client hardcodes `/api/v0` base URL default — must change to `/api/v1`
- `packages/cli` and `packages/mcp` hardcode `/api/v0` — must change to `/api/v1`

### External Dependencies (Require Manual Action)

- **Reddit Developer Console**: Update redirect URI from `*/media/api/auth/reddit/callback` → `*/api/auth/platforms/reddit/callback`
- **Twitter Developer Console**: Update redirect URI similarly
- **GitHub OAuth App (media connections)**: Update redirect URI similarly (this is the platform-connection OAuth app, NOT the login OAuth app)
- **GitHub OAuth App (login)**: Update callback from `*/api/auth/callback/github` → `*/api/auth/callback/github` (unchanged — already under `/api/auth`)

---

## Current Route Map (Complete)

### devpad routes — mounted at `/api/v0`
| Method | Current Path | Handler |
|--------|-------------|---------|
| GET | `/api/v0/` | Version info |
| GET | `/api/v0/projects` | List/get projects |
| GET | `/api/v0/projects/public` | Public projects |
| PATCH | `/api/v0/projects` | Upsert project |
| GET | `/api/v0/projects/:project_id/history` | Project history |
| GET | `/api/v0/projects/config` | Get config |
| PATCH | `/api/v0/projects/save_config` | Save config |
| GET | `/api/v0/projects/fetch_spec` | Fetch spec from GitHub |
| POST | `/api/v0/projects/scan` | Initiate scan (streaming) |
| GET | `/api/v0/projects/updates` | Pending scan updates |
| POST | `/api/v0/projects/scan_status` | Process scan results |
| GET | `/api/v0/projects/:id/milestones` | Project milestones |
| GET | `/api/v0/tasks` | List/get tasks |
| GET | `/api/v0/tasks/history/:task_id` | Task history |
| PATCH | `/api/v0/tasks` | Upsert task |
| PATCH | `/api/v0/tasks/save_tags` | Save task tags |
| GET | `/api/v0/tags` | User tags |
| GET | `/api/v0/repos` | GitHub repos |
| GET | `/api/v0/repos/:owner/:repo/branches` | Repo branches |
| GET | `/api/v0/auth/keys` | List API keys |
| POST | `/api/v0/auth/keys` | Create API key |
| DELETE | `/api/v0/auth/keys/:key_id` | Delete API key |
| PATCH | `/api/v0/user/preferences` | Update user prefs |
| GET | `/api/v0/user/history` | User history |
| GET | `/api/v0/milestones` | List milestones |
| GET | `/api/v0/milestones/:id` | Get milestone |
| POST | `/api/v0/milestones` | Create milestone |
| PATCH | `/api/v0/milestones/:id` | Update milestone |
| DELETE | `/api/v0/milestones/:id` | Delete milestone |
| GET | `/api/v0/goals` | List goals |
| GET | `/api/v0/goals/:id` | Get goal |
| POST | `/api/v0/goals` | Create goal |
| PATCH | `/api/v0/goals/:id` | Update goal |
| DELETE | `/api/v0/goals/:id` | Delete goal |
| GET | `/api/v0/milestones/:id/goals` | Milestone goals |

### devpad auth — mounted at `/api/auth`
| Method | Current Path | Handler |
|--------|-------------|---------|
| GET | `/api/auth/login` | GitHub OAuth initiate |
| GET | `/api/auth/callback/github` | GitHub OAuth callback |
| GET | `/api/auth/logout` | Session logout + redirect |
| GET | `/api/auth/session` | Session status |
| GET | `/api/auth/verify` | JWT/session verify |

### Blog routes — mounted at `/api/blog`
| Method | Current Path | Handler |
|--------|-------------|---------|
| GET/POST/PUT/PATCH/DELETE | `/api/blog/posts/*` | Blog post CRUD + versions |
| GET/POST/DELETE | `/api/blog/tags/*` | Blog tag management |
| GET/POST/DELETE | `/api/blog/categories/*` | Blog category tree |
| GET/POST/PUT/DELETE | `/api/blog/tokens/*` | Blog access key management |
| GET | `/api/blog/projects` | Blog project cache |
| POST | `/api/blog/projects/refresh` | Refresh blog project cache |

### Blog auth — mounted at `/blog/auth`
| Method | Current Path | Handler | Notes |
|--------|-------------|---------|-------|
| GET | `/blog/auth/status` | Auth status check | **REDUNDANT** — just checks `user` variable |
| GET | `/blog/auth/logout` | HTML page that deletes cookies | **REDUNDANT** — Astro page does the same |

### Blog health — mounted at `/blog/health`
| Method | Current Path | Handler | Notes |
|--------|-------------|---------|-------|
| GET | `/blog/health/` | JSON health check | **REDUNDANT** — identical to `/health` |

### Media auth — mounted at `/api/media/auth`
| Method | Current Path | Handler |
|--------|-------------|---------|
| GET | `/api/media/auth/reddit` | Reddit OAuth initiate |
| GET | `/api/media/auth/reddit/callback` | Reddit OAuth callback |
| GET | `/api/media/auth/twitter` | Twitter OAuth initiate |
| GET | `/api/media/auth/twitter/callback` | Twitter OAuth callback |
| GET | `/api/media/auth/github` | GitHub platform OAuth initiate |
| GET | `/api/media/auth/github/callback` | GitHub platform OAuth callback |
| GET | `/api/media/auth/login` | Redirect to devpad login |
| GET | `/api/media/auth/callback` | JWT callback handler |
| GET | `/api/media/auth/logout` | Delete cookies + redirect |
| POST | `/api/media/auth/logout` | JSON redirect response |

### Media data routes — already at `/api/v1`
| Method | Current Path | Handler |
|--------|-------------|---------|
| GET | `/api/v1/timeline/:user_id` | Get timeline |
| GET | `/api/v1/timeline/:user_id/raw/:platform` | Raw platform data |
| * | `/api/v1/connections/*` | Connection CRUD |
| * | `/api/v1/credentials/:platform` | Credential management |
| * | `/api/v1/profiles/*` | Profile CRUD + timelines |
| GET | `/api/v1/me` | Current user info |

### Global
| Method | Current Path | Handler |
|--------|-------------|---------|
| GET | `/health` | Health check |

---

## Proposed New Route Structure

### `/health` (unchanged)
| Method | New Path | Old Path | Notes |
|--------|----------|----------|-------|
| GET | `/health` | `/health` | Single health endpoint — absorbs `/blog/health` |

### `/api/auth` — Unified Authentication
| Method | New Path | Old Path | Notes |
|--------|----------|----------|-------|
| GET | `/api/auth/login` | `/api/auth/login` | **Unchanged** — devpad GitHub login |
| GET | `/api/auth/callback/github` | `/api/auth/callback/github` | **Unchanged** — devpad OAuth callback |
| GET | `/api/auth/logout` | `/api/auth/logout` | **Unchanged** — session logout |
| GET | `/api/auth/session` | `/api/auth/session` | **Unchanged** — session status |
| GET | `/api/auth/verify` | `/api/auth/verify` | **Unchanged** — JWT/session verify |
| GET | `/api/auth/platforms/reddit` | `/api/media/auth/reddit` | Platform OAuth initiate |
| GET | `/api/auth/platforms/reddit/callback` | `/api/media/auth/reddit/callback` | Platform OAuth callback |
| GET | `/api/auth/platforms/twitter` | `/api/media/auth/twitter` | Platform OAuth initiate |
| GET | `/api/auth/platforms/twitter/callback` | `/api/media/auth/twitter/callback` | Platform OAuth callback |
| GET | `/api/auth/platforms/github` | `/api/media/auth/github` | Platform OAuth initiate (connections, not login) |
| GET | `/api/auth/platforms/github/callback` | `/api/media/auth/github/callback` | Platform OAuth callback |

### `/api/v1` — All Data Routes

#### devpad core (moved from `/api/v0`)
| Method | New Path | Old Path |
|--------|----------|----------|
| GET | `/api/v1/` | `/api/v0/` |
| GET | `/api/v1/projects` | `/api/v0/projects` |
| GET | `/api/v1/projects/public` | `/api/v0/projects/public` |
| PATCH | `/api/v1/projects` | `/api/v0/projects` |
| GET | `/api/v1/projects/:project_id/history` | `/api/v0/projects/:project_id/history` |
| GET | `/api/v1/projects/config` | `/api/v0/projects/config` |
| PATCH | `/api/v1/projects/save_config` | `/api/v0/projects/save_config` |
| GET | `/api/v1/projects/fetch_spec` | `/api/v0/projects/fetch_spec` |
| POST | `/api/v1/projects/scan` | `/api/v0/projects/scan` |
| GET | `/api/v1/projects/updates` | `/api/v0/projects/updates` |
| POST | `/api/v1/projects/scan_status` | `/api/v0/projects/scan_status` |
| GET | `/api/v1/projects/:id/milestones` | `/api/v0/projects/:id/milestones` |
| GET | `/api/v1/tasks` | `/api/v0/tasks` |
| GET | `/api/v1/tasks/history/:task_id` | `/api/v0/tasks/history/:task_id` |
| PATCH | `/api/v1/tasks` | `/api/v0/tasks` |
| PATCH | `/api/v1/tasks/save_tags` | `/api/v0/tasks/save_tags` |
| GET | `/api/v1/tags` | `/api/v0/tags` |
| GET | `/api/v1/repos` | `/api/v0/repos` |
| GET | `/api/v1/repos/:owner/:repo/branches` | `/api/v0/repos/:owner/:repo/branches` |
| GET | `/api/v1/keys` | `/api/v0/auth/keys` |
| POST | `/api/v1/keys` | `/api/v0/auth/keys` |
| DELETE | `/api/v1/keys/:key_id` | `/api/v0/auth/keys/:key_id` |
| PATCH | `/api/v1/user/preferences` | `/api/v0/user/preferences` |
| GET | `/api/v1/user/history` | `/api/v0/user/history` |
| GET | `/api/v1/milestones` | `/api/v0/milestones` |
| GET | `/api/v1/milestones/:id` | `/api/v0/milestones/:id` |
| POST | `/api/v1/milestones` | `/api/v0/milestones` |
| PATCH | `/api/v1/milestones/:id` | `/api/v0/milestones/:id` |
| DELETE | `/api/v1/milestones/:id` | `/api/v0/milestones/:id` |
| GET | `/api/v1/goals` | `/api/v0/goals` |
| GET | `/api/v1/goals/:id` | `/api/v0/goals/:id` |
| POST | `/api/v1/goals` | `/api/v0/goals` |
| PATCH | `/api/v1/goals/:id` | `/api/v0/goals/:id` |
| DELETE | `/api/v1/goals/:id` | `/api/v0/goals/:id` |
| GET | `/api/v1/milestones/:id/goals` | `/api/v0/milestones/:id/goals` |

**Note on API keys**: Moved from `/api/v0/auth/keys` to `/api/v1/keys`. API keys are a data resource, not an auth flow — they don't belong under `/api/auth`.

#### Blog (moved from `/api/blog`)
| Method | New Path | Old Path |
|--------|----------|----------|
| * | `/api/v1/blog/posts/*` | `/api/blog/posts/*` |
| * | `/api/v1/blog/tags/*` | `/api/blog/tags/*` |
| * | `/api/v1/blog/categories/*` | `/api/blog/categories/*` |
| * | `/api/v1/blog/tokens/*` | `/api/blog/tokens/*` |
| * | `/api/v1/blog/projects/*` | `/api/blog/projects/*` |

#### Media (unchanged — already at `/api/v1`)
| Method | New Path | Old Path |
|--------|----------|----------|
| * | `/api/v1/timeline/*` | `/api/v1/timeline/*` |
| * | `/api/v1/connections/*` | `/api/v1/connections/*` |
| * | `/api/v1/credentials/*` | `/api/v1/credentials/*` |
| * | `/api/v1/profiles/*` | `/api/v1/profiles/*` |
| GET | `/api/v1/me` | `/api/v1/me` |

### Routes to DELETE

| Old Path | Reason |
|----------|--------|
| `/blog/health` | Redundant with `/health` |
| `/blog/auth/status` | Redundant — use `/api/auth/session` or `/api/auth/verify` |
| `/blog/auth/logout` | Redundant — blog Astro already has `/auth/logout` page |
| `/api/media/auth/login` | Redundant — use `/api/auth/login?return_to=...` directly |
| `/api/media/auth/callback` | Media-specific JWT callback — merge into `/api/auth/callback/github` flow |
| `/api/media/auth/logout` | Redundant — use `/api/auth/logout` |
| `POST /api/media/auth/logout` | Redundant — returns JSON redirect to devpad logout |

### Redundancy Analysis

#### Blog tokens vs devpad API keys
- **Blog tokens** (`/api/blog/tokens`): Blog-specific access keys for blog API access, stored in `blog_access_keys` table with numeric IDs, auto-generated tokens
- **devpad API keys** (`/api/v0/auth/keys`): General devpad API keys stored in `api_keys` table, used for CLI/MCP/external access
- **Verdict**: **NOT redundant** — they serve different purposes. Blog tokens gate blog-specific content publishing. devpad API keys gate the general devpad API. Keep both, but clarify naming in the future.

#### Blog projects vs devpad projects
- **Blog projects** (`/api/blog/projects`): Reads devpad projects table directly to populate a "project selector" in blog post editor. Has a `/refresh` endpoint that fetches from devpad API.
- **devpad projects** (`/api/v1/projects`): The canonical CRUD for projects.
- **Verdict**: Blog projects is a thin read-only view. Could be eliminated if blog frontend used `/api/v1/projects` directly, but that requires blog frontend to authenticate via devpad auth (which it already does). **Keep for now**, mark for future dedup.

---

## Hostname Routing Changes

### Current
```typescript
const BLOG_API_PREFIXES = ["/api/blog/", "/auth/", "/health"];
const MEDIA_API_PREFIXES = ["/api/v1/", "/api/auth/", "/health"];
```

### New
```typescript
const API_PREFIXES = ["/api/", "/health"];
```

All three hostnames (devpad.tools, blog.devpad.tools, media.devpad.tools) use the same prefix matching. Any request starting with `/api/` or `/health` goes to the Hono API app. Everything else goes to the respective Astro SSR handler.

This is simpler and eliminates the bug where `media.devpad.tools/media/api/v1/...` doesn't match `MEDIA_API_PREFIXES` because the path starts with `/media/` not `/api/`.

The media frontend currently uses `/media/api/v1/...` paths — these need to change to `/api/v1/...` (client-side) and use the `API_HANDLER` for SSR calls.

---

## File Changes

### Worker Entry — `packages/worker/src/index.ts`
**Changes:**
1. Replace `v0Routes` mount from `/api/v0` → `/api/v1`
2. Mount media auth under `/api/auth/platforms` instead of `/api/media/auth`
3. Mount blog routes under `/api/v1/blog` instead of `/api/blog`
4. Delete blog health and blog auth mounts
5. Delete `POST /api/media/auth/logout`
6. Simplify hostname routing to use unified `API_PREFIXES`
7. Move `/api/v1/me` handler into v0/v1 routes file

**Estimated: ~40 lines changed**

### v0 routes → v1 routes — `packages/worker/src/routes/v0.ts` → `packages/worker/src/routes/v1.ts`
**Changes:**
1. Rename file from `v0.ts` to `v1.ts`
2. Update the root handler `GET /` to return `{ version: "1", status: "ok" }`
3. Move API key routes from `/auth/keys` to `/keys` (they're data, not auth)
4. Add `/me` endpoint (moved from worker index.ts)

**Estimated: ~15 lines changed**

### Media auth routes — `packages/media-server/src/routes/auth.ts`
**Changes:**
1. Remove `/login`, `/callback`, `/logout` routes (these are devpad auth redirects, not needed)
2. Update redirect URIs in Reddit/Twitter/GitHub OAuth initiators from `/media/api/auth/*/callback` → use env var `API_URL + /api/auth/platforms/*/callback`

**Estimated: ~30 lines changed**

### Media OAuth helpers — `packages/media-server/src/oauth-helpers.ts`
**Changes:**
1. Update `validateOAuthRequest` redirect URI from `/media/api/auth/${platform}/callback` → `/api/auth/platforms/${platform}/callback`

**Estimated: ~5 lines changed**

### devpad API client — `packages/api/src/api-client.ts`
**Changes:**
1. Change default base URL from `http://localhost:4321/api/v0` to `http://localhost:4321/api/v1`
2. Update auth keys paths from `/auth/keys` to `/keys`
3. Update auth session/login/logout paths from `/auth/session` → `/../auth/session` — wait, this is relative to base URL. The base URL is `/api/v1` but auth is at `/api/auth`. The API client currently uses `this.clients.auth.get("/auth/session")` which resolves to `base_url + /auth/session` = `/api/v0/auth/session`. But `/api/auth/session` is NOT under `/api/v0` in current setup... Let me re-read...

Actually looking at the current API client, it constructs paths like `/auth/session` relative to base URL `/api/v0`, giving `/api/v0/auth/session`. But the actual auth routes are at `/api/auth/session`. The API client's auth methods call the v0-mounted auth routes at `/api/v0/auth/keys` etc, NOT the standalone `/api/auth/*` routes. The standalone `/api/auth/*` routes are for login/logout/session/verify. The API client's `auth.session()` calls `/api/v0/auth/session` — but wait, there IS no `/auth/session` in v0Routes! There's only `/auth/keys` in v0Routes.

Let me re-examine: the API client has:
```ts
session: () => this.clients.auth.get("/auth/session")  // → /api/v0/auth/session — DOES NOT EXIST in v0.ts!
login: () => this.clients.auth.get("/auth/login")       // → /api/v0/auth/login — DOES NOT EXIST in v0.ts!
logout: () => this.clients.auth.get("/auth/logout")     // → /api/v0/auth/logout — DOES NOT EXIST in v0.ts!
```

These are broken or unused. The actual auth routes are at `/api/auth/*` (the standalone auth Hono app). The frontend uses `/api/auth/login` directly (not through the API client). So the API client's auth.session/login/logout methods are effectively dead code.

**Revised changes for API client:**
1. Change default base URL from `/api/v0` to `/api/v1`
2. Move key paths from `/auth/keys` to `/keys`
3. Remove dead `auth.session()`, `auth.login()`, `auth.logout()` methods (they point to nonexistent paths)

**Estimated: ~25 lines changed**

### devpad frontend API client — `apps/main/src/utils/api-client.ts`
**Changes:**
1. Change `window.location.origin + "/api/v0"` → `window.location.origin + "/api/v1"`

**Estimated: ~2 lines changed**

### devpad frontend middleware — `apps/main/src/middleware.ts`
**Changes:**
1. Update `API_SERVER_URL.replace("/api/v0", "")` → `API_SERVER_URL.replace("/api/v1", "")`
2. Auth verify URL remains `/api/auth/verify` — no change needed there

**Estimated: ~2 lines changed**

### devpad frontend pages
| File | Change |
|------|--------|
| `apps/main/src/pages/docs.astro` | Update `/api/v0` reference to `/api/v1` |
| `apps/main/src/pages/401.astro` | `/api/auth/login` — no change |
| `apps/main/src/pages/account.astro` | `/api/auth/logout` — no change |
| `apps/main/src/components/solid/GithubLogin.tsx` | `/api/auth/login` — no change |
| `apps/main/.env.example` | Update `/api/v0` → `/api/v1` |

**Estimated: ~5 lines changed**

### Blog frontend — `apps/blog/src/lib/api.ts`
**Changes:**
1. Update `blog` path builder from `/api/blog` to `/api/v1/blog`
2. Update `auth` path builder — blog uses `/auth/status` for SSR. Since we're deleting `/blog/auth/status`, blog should use `/api/auth/session` instead.

**Estimated: ~5 lines changed**

### Blog frontend pages
| File | Change |
|------|--------|
| `apps/blog/src/pages/settings/index.astro` | `/auth/status` → `/api/auth/session`, `/api/blog/tokens` → `/api/v1/blog/tokens` |
| `apps/blog/src/pages/posts/index.astro` | `/api/blog/posts` → `/api/v1/blog/posts`, `/api/blog/projects` → `/api/v1/blog/projects` |
| `apps/blog/src/pages/categories/index.astro` | `/api/blog/categories` → `/api/v1/blog/categories` |
| `apps/blog/src/pages/posts/new.astro` | `/api/blog/categories` → `/api/v1/blog/categories`, `/api/blog/projects` → `/api/v1/blog/projects` |
| `apps/blog/src/pages/posts/[uuid]/versions.astro` | `/api/blog/posts` → `/api/v1/blog/posts` |
| `apps/blog/src/pages/posts/[slug].astro` | `/api/blog/posts` → `/api/v1/blog/posts`, etc. |
| `apps/blog/src/pages/auth/login.astro` | `/api/auth/login` — no change |
| `apps/blog/src/components/settings/settings-page.tsx` | `/api/blog/tokens` → `/api/v1/blog/tokens` |
| `apps/blog/src/components/category/categories-page.tsx` | `/api/blog/categories` → `/api/v1/blog/categories` |
| `apps/blog/src/components/post/project-selector.tsx` | `/api/blog/projects` → `/api/v1/blog/projects` |
| `apps/blog/src/components/post/post-editor.tsx` | `/api/blog/categories` → `/api/v1/blog/categories`, `/api/blog/posts` → `/api/v1/blog/posts` |

**Estimated: ~25 lines changed across all blog files**

### Media frontend — `apps/media/src/utils/api.ts`
**Changes:**
1. Remove `media: (path) => /media/api${path}` — no longer needed
2. Change `auth: (path) => /media/api/auth${path}` → remove (media has no auth routes of its own)
3. Change `timeline: (path) => /media/api/v1/timeline${path}` → `timeline: (path) => ${API_HOST}/api/v1/timeline${path}`
4. Change `connections` similarly
5. Change `profiles` similarly
6. Change `me` similarly
7. Update all API calls in `api.get`, `api.post` etc. that construct URLs via `apiUrls.media()`

**Estimated: ~20 lines changed**

### Media frontend pages/components
| File | Change |
|------|--------|
| `apps/media/src/utils/ssr-auth.ts` | `/api/auth/verify` — no change |
| `apps/media/src/pages/timeline/index.astro` | `/media/api/v1/profiles/...` → `/api/v1/profiles/...` |
| `apps/media/src/pages/connections/index.astro` | `/media/api/v1/profiles` → `/api/v1/profiles`, etc. |
| `apps/media/src/pages/dashboard/index.astro` | `/media/api/v1/profiles/...` → `/api/v1/profiles/...` |
| `apps/media/src/components/solid/ProfileSelector.tsx` | `/media/api/auth/login` → `/api/auth/login?return_to=...` |
| `apps/media/src/components/solid/AuthStatus.tsx` | `/media/api/auth/login` → `/api/auth/login?return_to=...`, `/media/api/auth/logout` → `/api/auth/logout` |

**Estimated: ~15 lines changed across media files**

### packages/server — `packages/server/src/server.ts` (dev server)
**Changes:**
1. Update middleware from `/api/v0/*` to `/api/v1/*`
2. Update route mount from `/api/v0` to `/api/v1`
3. Auth routes at `/api/auth` — no change

**Estimated: ~5 lines changed**

### packages/cli — `packages/cli/src/index.ts`
**Changes:**
1. Default URL from `https://devpad.tools/api/v0` → `https://devpad.tools/api/v1`

**Estimated: ~1 line changed**

### packages/mcp — `packages/mcp/src/index.ts`
**Changes:**
1. Default URL from `https://devpad.tools/api/v0` → `https://devpad.tools/api/v1`

**Estimated: ~1 line changed**

### Test files
| File | Change |
|------|--------|
| `packages/worker/src/__tests__/routes.test.ts` | `/api/v0/` → `/api/v1/` |
| `packages/api/tests/unit/clients/milestones.test.ts` | base_url `/api/v0` → `/api/v1` |
| Any integration tests referencing routes | Update accordingly |

**Estimated: ~15 lines changed**

### Documentation
| File | Change |
|------|--------|
| `packages/api/README.md` | `/api/v0` → `/api/v1` |
| `packages/mcp/README.md` | `/api/v0` → `/api/v1` |
| `packages/server/.env.example` | Callback URL update |
| `packages/cli/test-cli.sh` | `/api/v0` → `/api/v1` |

---

## Implementation Tasks

### Task 1: Rename v0 routes file and update mount point (Critical — must go first)
**Files:** `packages/worker/src/routes/v0.ts`, `packages/worker/src/index.ts`
**Sub-tasks:**
1. Rename `packages/worker/src/routes/v0.ts` → `packages/worker/src/routes/v1.ts` (~0 LoC, file rename)
2. Update the export name and import in `packages/worker/src/index.ts` (~3 LoC)
3. Change mount from `/api/v0` to `/api/v1` (~1 LoC)
4. Move `GET /api/v1/me` inline handler into the v1 routes file (~8 LoC)
5. Move API key routes from `/auth/keys` to `/keys` in v1 routes (~6 LoC: change 3 route paths)
6. Update version info handler to return `"1"` (~1 LoC)

**Est. total: ~20 LoC**
**Depends on:** Nothing

### Task 2: Consolidate auth routes in worker entry
**Files:** `packages/worker/src/index.ts`
**Sub-tasks:**
1. Mount media auth routes at `/api/auth/platforms` instead of `/api/media/auth` (~2 LoC)
2. Remove the `POST /api/media/auth/logout` handler (~3 LoC deleted)
3. Remove blog auth mount (`/blog/auth`) (~1 LoC deleted)
4. Remove blog health mount (`/blog/health`) (~1 LoC deleted)

**Est. total: ~7 LoC changed**
**Depends on:** Task 1 (same file)

### Task 3: Consolidate blog routes mount point
**Files:** `packages/worker/src/index.ts`
**Sub-tasks:**
1. Change blog router mount from `/api/blog` to `/api/v1/blog` (~1 LoC)

**Est. total: ~1 LoC**
**Depends on:** Task 1 (same file)

### Task 4: Simplify hostname routing
**Files:** `packages/worker/src/index.ts`
**Sub-tasks:**
1. Replace `BLOG_API_PREFIXES` and `MEDIA_API_PREFIXES` with unified `API_PREFIXES = ["/api/", "/health"]` (~5 LoC)
2. Simplify the three hostname blocks to all use the same prefix check (~10 LoC)

**Est. total: ~15 LoC**
**Depends on:** Tasks 1-3 (same file — all worker entry changes should be one task)

### Task 5: Update media-server OAuth redirect URIs
**Files:** `packages/media-server/src/routes/auth.ts`, `packages/media-server/src/oauth-helpers.ts`
**Sub-tasks:**
1. Change Reddit redirect URI from `/media/api/auth/reddit/callback` → `/api/auth/platforms/reddit/callback` (~1 LoC)
2. Change Twitter redirect URI similarly (~1 LoC)
3. Change GitHub redirect URI similarly (~1 LoC)
4. Update `oauth-helpers.ts` generic redirect URI (~1 LoC)
5. Remove `/login`, `/callback`, `/logout` routes from media auth.ts (~25 LoC deleted)

**Est. total: ~30 LoC changed**
**Depends on:** Nothing (different package)

### Task 6: Update devpad API client package
**Files:** `packages/api/src/api-client.ts`
**Sub-tasks:**
1. Change default base URL to `/api/v1` (~1 LoC)
2. Update auth.keys paths from `/auth/keys` to `/keys` (~3 LoC)
3. Remove dead `auth.session()`, `auth.login()`, `auth.logout()` methods (~12 LoC deleted)

**Est. total: ~16 LoC changed**
**Depends on:** Nothing (different package)

### Task 7: Update devpad frontend (apps/main)
**Files:** `apps/main/src/utils/api-client.ts`, `apps/main/src/middleware.ts`, `apps/main/src/pages/docs.astro`, `apps/main/.env.example`
**Sub-tasks:**
1. Change `api-client.ts` base URL from `/api/v0` to `/api/v1` (~1 LoC)
2. Update `middleware.ts` replace from `/api/v0` to `/api/v1` (~1 LoC)
3. Update `docs.astro` text reference (~1 LoC)
4. Update `.env.example` (~2 LoC)

**Est. total: ~5 LoC**
**Depends on:** Nothing (different package)

### Task 8: Update blog frontend (apps/blog)
**Files:** `apps/blog/src/lib/api.ts`, all blog pages and components that reference `/api/blog`
**Sub-tasks:**
1. Update `api.ts` blog path builder from `/api/blog` → `/api/v1/blog` (~1 LoC)
2. Update `api.ts` auth path builder to use `/api/auth` (~1 LoC)
3. Update `settings/index.astro` SSR calls (~2 LoC)
4. Update `posts/index.astro` SSR calls (~2 LoC)
5. Update `categories/index.astro` SSR calls (~1 LoC)
6. Update `posts/new.astro` SSR calls (~2 LoC)
7. Update `posts/[uuid]/versions.astro` SSR calls (~2 LoC)
8. Update `posts/[slug].astro` SSR calls (~3 LoC)
9. Update `settings-page.tsx` client calls (~4 LoC)
10. Update `categories-page.tsx` client calls (~3 LoC)
11. Update `project-selector.tsx` client calls (~2 LoC)
12. Update `post-editor.tsx` client calls (~2 LoC)

**Est. total: ~25 LoC**
**Depends on:** Nothing (different package)

### Task 9: Update media frontend (apps/media)
**Files:** `apps/media/src/utils/api.ts`, media pages and components
**Sub-tasks:**
1. Update `api.ts` apiUrls to remove `/media/` prefix from all paths (~8 LoC)
2. Update `timeline/index.astro` SSR path (~1 LoC)
3. Update `connections/index.astro` SSR paths (~2 LoC)
4. Update `dashboard/index.astro` SSR path (~1 LoC)
5. Update `ProfileSelector.tsx` login redirect (~1 LoC)
6. Update `AuthStatus.tsx` login/logout URLs (~2 LoC)

**Est. total: ~15 LoC**
**Depends on:** Nothing (different package)

### Task 10: Update packages/server dev server
**Files:** `packages/server/src/server.ts`
**Sub-tasks:**
1. Change middleware path from `/api/v0/*` to `/api/v1/*` (~1 LoC)
2. Change route mount from `/api/v0` to `/api/v1` (~1 LoC)

**Est. total: ~2 LoC**
**Depends on:** Nothing (different package)

### Task 11: Update CLI and MCP packages
**Files:** `packages/cli/src/index.ts`, `packages/mcp/src/index.ts`, `packages/cli/test-cli.sh`
**Sub-tasks:**
1. CLI default URL → `/api/v1` (~1 LoC)
2. MCP default URL → `/api/v1` (~1 LoC)
3. CLI test script → `/api/v1` (~1 LoC)

**Est. total: ~3 LoC**
**Depends on:** Nothing

### Task 12: Update tests
**Files:** `packages/worker/src/__tests__/routes.test.ts`, `packages/api/tests/unit/clients/milestones.test.ts`, other test files
**Sub-tasks:**
1. Update worker route tests from `/api/v0` → `/api/v1` (~10 LoC)
2. Update API client unit test base URL (~1 LoC)
3. Search for any other test files with `/api/v0` references (~5 LoC est.)

**Est. total: ~16 LoC**
**Depends on:** Tasks 1 + 6 (tests exercise the changed code)

### Task 13: Update documentation
**Files:** `packages/api/README.md`, `packages/mcp/README.md`, `packages/server/.env.example`
**Sub-tasks:**
1. API README → `/api/v1` (~3 LoC)
2. MCP README → `/api/v1` (~1 LoC)
3. Server env example callback URL (~1 LoC)

**Est. total: ~5 LoC**
**Depends on:** Nothing

---

## Phase Execution Plan

### Phase 1: Worker Entry + Server-Side Route Changes
All server-side route mounting changes. Tasks 1-4 all touch `packages/worker/src/index.ts` so they must be done by ONE agent.

**Agent A (worker entry):** Tasks 1, 2, 3, 4 — Rename v0→v1, consolidate auth mounts, blog mounts, simplify hostname routing. All in `packages/worker/src/index.ts` + rename `v0.ts` → `v1.ts`.

**Agent B (media-server):** Task 5 — Update OAuth redirect URIs and remove redundant routes in `packages/media-server/src/routes/auth.ts` + `packages/media-server/src/oauth-helpers.ts`.

**Agent C (dev server):** Task 10 — Update `packages/server/src/server.ts` route mounts.

→ **Verification Agent**: typecheck, test, commit "consolidate routes under /api/v1 and /api/auth"

### Phase 2: Package Updates (parallel)
Packages that consume the API — all independent, different files.

**Agent A:** Task 6 — Update `packages/api/src/api-client.ts`

**Agent B:** Task 11 — Update CLI + MCP defaults

→ **Verification Agent**: typecheck, test, commit "update api client and tool defaults to /api/v1"

### Phase 3: Frontend Updates (parallel)
Three Astro apps, completely independent codebases.

**Agent A:** Task 7 — Update devpad frontend (`apps/main`)

**Agent B:** Task 8 — Update blog frontend (`apps/blog`)

**Agent C:** Task 9 — Update media frontend (`apps/media`)

→ **Verification Agent**: typecheck, test, commit "update all frontends to use /api/v1 route paths"

### Phase 4: Tests + Documentation
**Agent A:** Task 12 — Update all test files

**Agent B:** Task 13 — Update documentation

→ **Verification Agent**: typecheck, test, commit "update tests and docs for /api/v1 routes"

---

## Total Estimated Effort

| Category | Lines Changed |
|----------|--------------|
| Worker entry (index.ts + v1.ts) | ~45 |
| Media server (auth + oauth-helpers) | ~30 |
| Dev server | ~2 |
| API client package | ~16 |
| CLI + MCP | ~3 |
| devpad frontend | ~5 |
| Blog frontend | ~25 |
| Media frontend | ~15 |
| Tests | ~16 |
| Documentation | ~5 |
| **Total** | **~162** |

---

## Limitations & Notes

1. **No backwards compatibility shims** — old `/api/v0` paths will 404 immediately. Any external consumers (bookmarked URLs, CI scripts, browser caches) will break. This is intentional per our "move fast" philosophy, but worth flagging.

2. **OAuth redirect URIs require manual console updates** — Reddit/Twitter/GitHub developer consoles must have their callback URLs updated BEFORE or simultaneously with deployment. Stagger this: update consoles first to accept BOTH old and new callback URLs, deploy, then remove old URLs.

3. **Blog projects overlap** — `/api/v1/blog/projects` is a read-only cache of devpad projects for the blog editor. It's not technically redundant but is a duplication of data access. Future cleanup could have the blog frontend call `/api/v1/projects` directly.

4. **Blog auth flow** — Blog currently redirects `/auth/login` → devpad `/api/auth/login?return_to=blog_callback`. This continues to work unchanged. The `/blog/auth/status` endpoint was used for SSR auth checks — blog will now use `/api/auth/session` which returns the same shape (plus more data).

5. **Media `/media/api/` prefix bug** — The current media frontend uses `/media/api/v1/...` paths for SSR calls, which go through `API_HANDLER` but the Hono app doesn't have routes at `/media/api/v1/...`. This appears to be a latent bug from the unification — either these calls are failing silently, or there's some URL rewriting I didn't find. Either way, changing to `/api/v1/...` fixes it.

6. **`packages/server` (dev server)** — This is the Bun dev server used for local development. It also needs the `/api/v0` → `/api/v1` change to stay in sync with the worker.

---

## Approval Required

**The hostname routing simplification (Task 4)** is architecturally significant. Changing from per-hostname API prefix matching to a unified `["/api/", "/health"]` pattern means ALL subdomains will route ALL `/api/` paths to the same Hono app. This is correct because the Hono app already handles all routes, but it's worth confirming there are no edge cases where blog.devpad.tools should NOT expose media routes or vice versa. Currently there's no route-level authorization by subdomain — any authenticated user can hit any route from any subdomain. If subdomain-scoped access control is wanted in the future, it should be middleware, not hostname routing.
