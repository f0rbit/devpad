# devpad Unified Platform Roadmap

## Executive Summary

This document is a comprehensive analysis and migration roadmap for merging three projects — **devpad**, **dev-blog**, and **media-timeline** — into a unified platform served by a single Cloudflare Worker, leveraging two shared libraries (**@f0rbit/ui** and **@f0rbit/corpus**).

**The core thesis**: devpad currently runs on a VPS as a Docker container with a Go binary dependency (`todo-tracker`). Both dev-blog and media-timeline already run as Cloudflare Workers with D1 databases and R2 storage. The migration path is to bring devpad into the Cloudflare ecosystem, rewrite the Go `todo-tracker` in TypeScript, and unify all three under a single Worker deployment.

### Key Findings

1. **dev-blog and media-timeline are already Cloudflare-native** — both use Hono + D1 + R2, have `wrangler.toml` configs, and deploy as Workers. devpad is the outlier running on a VPS with Docker.
2. **All three share the same auth model** — dev-blog and media-timeline delegate auth to devpad's `/api/auth/verify` endpoint. This is the architectural linchpin.
3. **The Go `todo-tracker` binary is simple** (~500 lines) — a TypeScript port is straightforward and necessary since Workers can't run Go binaries.
4. **`@f0rbit/corpus`** is already used by dev-blog and media-timeline for versioned data storage with Cloudflare R2 backends. It also provides the Result/pipe utilities used across all projects.
5. **`@f0rbit/ui`** is a SolidJS component library already published as `@f0rbit/ui`. All three frontends use Astro + SolidJS.

---

## 1. Current State Analysis

### 1.1 devpad (Task + Project Management)

| Aspect | Details |
|--------|---------|
| **Location** | `~/dev/devpad` |
| **Stack** | Bun + Hono (server), Astro + SolidJS (frontend), SQLite + Drizzle ORM |
| **Deployment** | Docker on VPS (Dockerfile builds Go binary + Bun app) |
| **Database** | SQLite file on disk (`/app/data/devpad.db`) |
| **Auth** | Lucia (session-based) + GitHub OAuth + API keys + JWT |
| **Key Feature** | Code scanning via external `todo-tracker` Go binary |
| **Published Packages** | `@devpad/api` (npm, API client), `@devpad/schema` (types), `@devpad/mcp` (MCP server) |
| **Tests** | Integration tests via in-process Hono server with real SQLite |

**Packages:**
- `@devpad/schema` — Drizzle schema, Zod validation, TypeScript types
- `@devpad/core` — Business logic services (projects, tasks, scanning, milestones, goals, tags, auth)
- `@devpad/server` — Hono routes (v0 API, auth)
- `@devpad/app` — Astro SSR frontend with SolidJS components
- `@devpad/api` — Published npm client for external consumers
- `@devpad/cli` — CLI tool
- `@devpad/mcp` — MCP (Model Context Protocol) server

**API Surface** (`/api/v0/*`):
- `GET/PATCH /projects` — CRUD projects
- `GET/PATCH /tasks` — CRUD tasks
- `GET/POST /milestones` — CRUD milestones  
- `GET/POST /goals` — CRUD goals
- `GET /tags` — List tags
- `POST /projects/scan` — Initiate code scan (streaming)
- `GET /projects/updates` — Get pending scan updates
- `POST /projects/scan_status` — Accept/reject scan results
- `GET/POST/DELETE /auth/keys` — API key management
- `GET /repos` — GitHub repos
- `PATCH /user/preferences` — User settings

**What's Working Well:**
- Comprehensive API with Result-wrapped client (`@devpad/api`)
- Clean separation of concerns (schema/core/server/app)
- Good integration test infrastructure (in-process server + real DB)
- Published npm packages consumed by other projects

**What's Not Working Well:**
- VPS deployment is heavyweight (Docker + Go binary)
- Go binary dependency blocks Cloudflare migration
- `bun:sqlite` driver locks it to Bun runtime (can't use in Workers)
- Heavy debug logging in production routes (PATCH /projects)
- Auth uses Lucia which is tied to Node.js/Bun runtime

### 1.2 dev-blog (Developer Blog)

| Aspect | Details |
|--------|---------|
| **Location** | `~/dev/dev-blog` |
| **Stack** | Hono (API), Astro + SolidJS (frontend), D1 + Drizzle ORM |
| **Deployment** | Cloudflare Worker (`blog.devpad.tools`) |
| **Database** | Cloudflare D1 |
| **Storage** | Cloudflare R2 (via `@f0rbit/corpus`) |
| **Auth** | Delegates to devpad `/api/auth/verify` (cookie-forwarding or JWT) |

**Key Features:**
- Blog post management with versioned content (corpus snapshots)
- Category and tag system
- devpad project integration (fetch projects via devpad API)
- Access tokens for API auth
- Content stored in R2 via corpus with versioning

**API Surface** (`/api/blog/*`):
- `/api/blog/posts` — CRUD blog posts
- `/api/blog/tags` — Post tags
- `/api/blog/categories` — Categories
- `/api/blog/tokens` — Access tokens
- `/api/blog/projects` — Project integration (fetches from devpad)
- `/auth/*` — Login/callback (delegates to devpad)

**Integration with devpad:**
- Auth: Verifies sessions by calling `devpad.tools/api/auth/verify`
- Projects: Fetches project list via devpad API with JWT auth
- Uses `@f0rbit/corpus` for versioned content storage

### 1.3 media-timeline (Social Media Timeline Aggregator)

| Aspect | Details |
|--------|---------|
| **Location** | `~/dev/media-timeline` |
| **Stack** | Hono (API), Astro + SolidJS (frontend), D1 + Drizzle ORM |
| **Deployment** | Cloudflare Worker (`media.devpad.tools`) |
| **Database** | Cloudflare D1 |
| **Storage** | Cloudflare R2 (via `@f0rbit/corpus`) |
| **Auth** | Delegates to devpad `/api/auth/verify` |
| **Cron** | Cloudflare Worker cron trigger every 5 minutes |

**Key Features:**
- Multi-platform timeline aggregation (Twitter/X, Reddit, GitHub, Bluesky, YouTube, devpad)
- Profile-based filtering and grouping
- OAuth flow for connecting platform accounts
- Encrypted credential storage
- Rate limiting with circuit breaker pattern
- Cron-based background sync

**API Surface** (`/api/v1/*`):
- `/api/v1/timeline` — Aggregated timeline
- `/api/v1/connections` — Platform connections
- `/api/v1/credentials` — Platform credentials
- `/api/v1/profiles` — User profiles
- `/api/auth/*` — OAuth flows for platforms

**Integration with devpad:**
- Auth: Verifies sessions via devpad `/api/auth/verify`
- Has a `DevpadProvider` that fetches tasks from devpad API for timeline display
- Uses `@f0rbit/corpus` for data snapshots

### 1.4 @f0rbit/ui (Shared UI Library)

| Aspect | Details |
|--------|---------|
| **Location** | `~/dev/ui` |
| **Published** | `@f0rbit/ui` on npm (v0.1.9) |
| **Stack** | SolidJS components, CSS tokens/utilities |
| **Build** | tsup with SolidJS preset |

**Component Inventory:**
- Layout: Card, Modal, Tabs, Collapsible, Stepper, Tree
- Form: Button, Input/Textarea/Select, Checkbox, Toggle, FormField, ChipInput, MultiSelect
- Data: Badge, Status, Stat, Spinner, Timeline, Chevron, Empty, Clamp, Dropdown

**CSS Exports:**
- `@f0rbit/ui/styles` — Full stylesheet
- `@f0rbit/ui/styles/tokens` — Design tokens
- `@f0rbit/ui/styles/reset` — CSS reset
- `@f0rbit/ui/styles/utilities` — Utility classes
- `@f0rbit/ui/styles/components` — Component styles

**Usage Status:**
- media-timeline has a `ui-overrides.css` and uses it heavily
- dev-blog has plans for migration (`.plans/ui-library-migration.md`)
- devpad frontend doesn't appear to use it yet (custom components)

### 1.5 @f0rbit/corpus (Versioned Data Storage)

| Aspect | Details |
|--------|---------|
| **Location** | `~/dev/corpus` |
| **Published** | `@f0rbit/corpus` on npm (v0.3.4) |
| **Stack** | TypeScript, Zod, Drizzle ORM (schema only) |

**Key Capabilities:**
- **Versioned snapshot storage** with content-addressable deduplication
- **Multiple backends**: Memory (testing), File (local dev), Cloudflare R2 (production), Layered (cache)
- **Result type system**: `ok()`, `err()`, `pipe()`, `match()`, `unwrap_or()`, `try_catch()`, `fetch_result()`
- **Codec system**: JSON, text, binary encoders/decoders
- **Observations**: Annotation system for snapshot data
- **Concurrency**: Semaphore and parallel_map utilities
- **Drizzle schema**: `corpus_snapshots` table for metadata

**Already Used By:**
- dev-blog: Post content versioning (R2 backend)
- media-timeline: Data snapshots, `corpus_snapshots` in DB schema, Result/pipe utilities
- Both use `@f0rbit/corpus` Result types extensively (`ok`, `err`, `pipe`, `try_catch_async`)

**Potential for devpad:**
- Replace the custom `result.ts` in `@devpad/api` with `@f0rbit/corpus` Result types
- Use corpus for scan result versioning (instead of raw JSON in `tracker_result.data`)
- Use pipe/Result patterns throughout core services

---

## 2. Unified Cloudflare Worker Architecture

### 2.1 Target Architecture

```
single-worker/
├── packages/
│   ├── schema/           # Shared Drizzle schema (all three DBs) + types
│   │   ├── devpad/       # devpad tables
│   │   ├── blog/         # blog tables  
│   │   └── media/        # media-timeline tables
│   ├── auth/             # Unified auth (devpad is source of truth)
│   │   ├── lucia-d1.ts   # Lucia adapter for D1
│   │   ├── oauth.ts      # GitHub OAuth
│   │   ├── jwt.ts        # JWT signing/verification
│   │   └── middleware.ts  # Hono auth middleware
│   ├── devpad/           # devpad business logic
│   │   ├── services/     # Project, task, scanning, milestones, goals
│   │   ├── routes/       # Hono routes (/api/v0/*)
│   │   └── scanner/      # TypeScript todo-tracker replacement
│   ├── blog/             # Blog business logic
│   │   ├── services/     # Posts, categories, tags
│   │   ├── routes/       # Hono routes (/api/blog/*)
│   │   └── corpus/       # Post content management
│   ├── media/            # Media timeline business logic
│   │   ├── services/     # Timeline, connections, profiles
│   │   ├── routes/       # Hono routes (/api/v1/*)
│   │   ├── platforms/    # Platform providers (twitter, reddit, github, etc.)
│   │   └── cron/         # Cron processors
│   └── worker/           # Cloudflare Worker entry point
│       ├── index.ts      # Request routing + cron handler
│       └── bindings.ts   # CF bindings (D1, R2, env vars)
├── apps/
│   ├── devpad/           # Astro frontend for devpad
│   ├── blog/             # Astro frontend for blog
│   └── media/            # Astro frontend for media-timeline
├── wrangler.toml
└── package.json
```

### 2.2 Request Routing Design

The single worker routes requests based on hostname + path:

```typescript
// worker/index.ts
export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext) {
    const url = new URL(request.url);
    const host = url.hostname;
    
    // API routing (all domains share the same API)
    if (url.pathname.startsWith('/api/')) {
      return apiRouter.fetch(request, env, ctx);
    }
    
    // Static assets + SSR based on domain
    switch (host) {
      case 'devpad.tools':
        return devpadApp.fetch(request, env, ctx);
      case 'blog.devpad.tools':
        return blogApp.fetch(request, env, ctx);
      case 'media.devpad.tools':
        return mediaApp.fetch(request, env, ctx);
      default:
        return new Response('Not Found', { status: 404 });
    }
  },
  
  async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    // Media-timeline cron jobs
    ctx.waitUntil(handleMediaCron(env));
  }
};
```

**API Path Structure:**
- `/api/auth/*` — Unified auth (login, callback, verify, session, keys)
- `/api/v0/*` — devpad API (projects, tasks, milestones, goals, scanning)
- `/api/blog/*` — Blog API (posts, categories, tags)
- `/api/v1/*` — Media timeline API (timeline, connections, profiles)
- `/health` — Health check

### 2.3 Database Strategy

**Option A: Single D1 database with prefixed tables** (Recommended)
- All three projects share one D1 database
- Tables already use different names (devpad: `project`, `task`; blog: `blog_posts`, `blog_categories`; media: `media_users`, `media_profiles`)
- Simplest to manage, single migration history
- Auth tables are shared (devpad's `user` and `session` tables)

**Option B: Separate D1 databases per domain**
- devpad-db, blog-db, media-db
- More isolation but more complexity
- Auth DB needs to be shared or duplicated

**Recommendation: Option A** — the table prefixes already exist and this avoids cross-database auth lookups. Media-timeline already uses `media_` prefix, blog uses `blog_` prefix.

**Migration approach:**
1. Create new D1 database with combined schema
2. Export existing D1 data from blog and media
3. Migrate devpad SQLite data via drizzle-kit push
4. Update all Drizzle schema files to use D1 driver instead of `bun:sqlite`

### 2.4 Authentication Strategy

devpad is the **auth source of truth**. Currently:
- devpad uses **Lucia** with `bun:sqlite` adapter
- dev-blog and media-timeline call `devpad.tools/api/auth/verify` to validate sessions

**For the unified worker:**
1. Switch Lucia to use D1 adapter (or replace Lucia entirely with a lighter custom solution)
2. Auth middleware lives in the shared `auth/` package
3. All three APIs use the same middleware — no more remote verification calls
4. GitHub OAuth flow produces sessions stored in the shared D1 database
5. JWT tokens signed by the worker, verified locally (no network hop)

**This eliminates the remote auth verification pattern** — dev-blog and media-timeline currently make HTTP calls back to devpad for every authenticated request. In a unified worker, they just read from the same DB.

### 2.5 Static Asset Strategy

**Cloudflare Pages (recommended) or Worker Assets:**

Each frontend (devpad, blog, media) builds as a static Astro site with SSR handler. Options:

1. **Cloudflare Pages per app** — Each app deploys as a Pages project, Worker handles only API. Pages projects reverse-proxy API calls.
2. **Worker Assets** — Single worker serves everything, using `wrangler.toml` `[assets]` config. More complex but single deployment.
3. **Hybrid** — Worker handles API + SSR, Pages serves static assets via custom domain.

**Recommendation:** Start with **Worker Assets for API + SSR** and serve static files from the same worker. This is what dev-blog and media-timeline already do. Each app builds into a `dist/` folder, and the unified worker routes to the correct SSR handler based on hostname.

---

## 3. todo-tracker Migration (Go -> TypeScript)

### 3.1 Current Go Binary Analysis

The `todo-tracker` binary (located at `~/dev/todo-tracker`) has two commands:

**`parse <directory> <config.json>`** (~200 lines)
- Walks a directory tree, skipping ignored paths (regex) and binary files
- For each text file, scans every line for tag matches (string `Index`)
- Extracts: UUID, file path, line number, tag name, text after match, context (4 lines before, 6 lines after)
- Outputs JSON array of `ParsedTask` objects
- Uses goroutines for parallel file processing

**`diff <old.json> <new.json>`** (~130 lines)
- Reads two JSON files of `ParsedTask` arrays
- Compares by text match (SAME/MOVE), then line+tag match (UPDATE), else NEW
- Detects DELETE (items in old but not new)
- Outputs JSON array of `DiffResult` objects with type: SAME | MOVE | UPDATE | NEW | DELETE

**Data Types:**
```typescript
type Config = { tags: { name: string; match: string[] }[]; ignore: string[] };
type ParsedTask = { id: string; file: string; line: number; tag: string; text: string; context: string[] };
type DiffResult = { id: string; tag: string; type: "SAME"|"MOVE"|"UPDATE"|"NEW"|"DELETE"; data: { old?: DiffInfo; new?: DiffInfo } };
type DiffInfo = { text: string; line: number; file: string; context: string[] };
```

### 3.2 Current Integration Flow

1. **Scan Initiation** (`POST /projects/scan`):
   - Validate project ownership
   - Download repo as zip from GitHub API (using access token)
   - Unzip to `/tmp/` directory
   - Write config.json from project settings
   - **Shell exec**: `todo-tracker parse <folder> <config.json> > new-output.json`
   - Save parse results to `tracker_result` table
   - Fetch previous accepted scan's codebase_tasks
   - **Shell exec**: `todo-tracker diff old-output.json new-output.json > diff-output.json`
   - Save diff to `todo_updates` table
   - Stream progress via SSE

2. **Review** (`GET /projects/updates`): Fetch pending updates
3. **Accept/Reject** (`POST /projects/scan_status`): Process actions (CREATE/CONFIRM/UNLINK/DELETE/COMPLETE/IGNORE)

### 3.3 TypeScript Reimplementation Design

**Key insight:** We don't need to download/unzip repos. We can use the **GitHub API to fetch file contents directly** — specifically the Trees API to list files and the Contents API to read them. This eliminates filesystem operations entirely, making it Workers-compatible.

```typescript
// scanner/parser.ts
type ScanConfig = { tags: TagMatcher[]; ignore: RegExp[] };
type TagMatcher = { name: string; match: string[] };

async function* parseGitHubRepo(
  owner: string, 
  repo: string, 
  branch: string,
  accessToken: string, 
  config: ScanConfig
): AsyncGenerator<ParsedTask> {
  // 1. Get repo tree (recursive) via GitHub Trees API
  //    GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1
  // 2. Filter out ignored paths and binary files
  // 3. For each text file, fetch content via Contents API
  //    GET /repos/{owner}/{repo}/contents/{path}?ref={branch}
  // 4. Scan each file line-by-line for tag matches
  // 5. Yield ParsedTask objects
}

// scanner/diff.ts
function generateDiff(oldTasks: ParsedTask[], newTasks: ParsedTask[]): DiffResult[] {
  // Pure function - direct port of Go diff logic
  // ~50 lines of TypeScript
}
```

**Advantages of GitHub API approach:**
- No filesystem operations (Workers-compatible)
- No need to download/unzip entire repos
- Can selectively fetch only changed files (future optimization)
- Can cache file contents via corpus
- No Go binary dependency

**`@f0rbit/corpus` integration:**
- Store scan results as corpus snapshots (versioned, deduped)
- Store parsed file contents in corpus for caching
- Use corpus observations to annotate scan findings

### 3.4 Estimated Effort

| Component | Lines | Complexity |
|-----------|-------|------------|
| `parser.ts` — File scanning + tag matching | ~120 | M |
| `github-tree.ts` — GitHub API tree/content fetching | ~80 | S |
| `diff.ts` — Diff engine (direct port) | ~60 | S |
| `scanner.ts` — Orchestration (replaces scanning.ts) | ~150 | L |
| Unit tests for parser | ~60 | S |
| Unit tests for diff | ~60 | S |
| Integration test for full scan workflow | ~100 | M |
| **Total** | **~630** | |

---

## 4. UI Consolidation

### 4.1 Current Component Usage

| App | Uses @f0rbit/ui | Custom Components |
|-----|-----------------|-------------------|
| devpad | No | ProjectCard, TaskCard, TaskEditor, TagEditor, MilestonesManager, etc. |
| dev-blog | Partially (planned migration) | PostEditor, CategoryForm, SettingsPage, etc. |
| media-timeline | Yes | Dashboard, Timeline, ConnectionCard, PlatformSettings, etc. |

### 4.2 Migration Strategy

1. **devpad frontend** is the biggest consumer of custom components. Many map to existing `@f0rbit/ui` components:
   - `LoadingIndicator` -> `Spinner`
   - `ProjectCard` -> `Card` + custom content
   - `TaskCard` -> `Card` + `Badge` + `Status`
   - `TagEditor` -> `ChipInput` or `MultiSelect`
   - `UpdateDiff` -> `Timeline`
   - `HistoryTimeline` -> `Timeline`

2. **New components needed:**
   - `DataTable` — For task/project lists
   - `SearchInput` — For filtering
   - `ProgressBar` — For task progress visualization

3. **Strategy**: Migrate incrementally per-component. Don't block the platform migration on UI consolidation.

---

## 5. Migration Roadmap

### Phase 1: Foundation (MVP Unified Worker)

**Goal:** Get devpad API running as a Cloudflare Worker alongside blog and media APIs.

#### Task 1.1: Create unified monorepo structure
- Create new monorepo with workspace setup
- Move schema definitions for all three projects
- Set up shared wrangler.toml with D1 + R2 bindings
- **Est:** ~200 lines, **Size:** M

#### Task 1.2: Migrate Drizzle schema to D1-compatible driver
- Replace `bun:sqlite` with `drizzle-orm/d1` driver
- Combine all schemas into shared package with prefixed tables
- Generate D1 migrations via drizzle-kit
- **Est:** ~300 lines, **Size:** M
- **CRITICAL DEPENDENCY** — blocks everything else

#### Task 1.3: Replace Lucia auth with D1-compatible solution
- Options: (a) Use Lucia's D1 adapter if it exists, (b) Write minimal session management
- Lucia has no D1 adapter — need custom session management
- Port JWT signing/verification to Web Crypto API (Workers-compatible)
- Port API key verification to D1 queries
- **Est:** ~400 lines, **Size:** L
- **CRITICAL DECISION NEEDED** — see Section 6

#### Task 1.4: Port devpad core services to D1
- Replace all `bun:sqlite` Drizzle queries with D1-compatible queries
- Remove `Bun.env` references (use Worker env bindings instead)
- Remove Node.js-specific imports (`child_process`, `fs`, `Buffer`)
- **Est:** ~600 lines (mostly find-replace + testing), **Size:** L

#### Task 1.5: Implement TypeScript todo-tracker (parser + diff)
- Port parse logic from Go to TypeScript
- Port diff logic from Go to TypeScript
- Implement GitHub Tree/Contents API client
- Replace `scanRepo()` with Workers-compatible implementation
- **Est:** ~500 lines, **Size:** L
- **Can run in parallel with 1.2-1.4**

#### Task 1.6: Create unified Worker entry point
- Hostname-based routing for SSR
- Path-based routing for APIs
- Cron handler for media-timeline
- Shared bindings and context
- **Est:** ~200 lines, **Size:** M

#### Task 1.7: Database migration scripts
- Export devpad SQLite data
- Import into D1
- Verify data integrity
- **Est:** ~150 lines, **Size:** M

#### Task 1.8: Integration tests for unified worker
- Adapt existing test infrastructure to use D1 (or in-memory SQLite for tests)
- Test cross-domain auth
- Test each API surface
- **Est:** ~400 lines, **Size:** L

**Phase 1 Dependency Graph:**
```
1.1 ──> 1.2 ──> 1.4 ──> 1.6 ──> 1.8
         │                │
         └──> 1.3 ────────┘
                           
1.5 (parallel) ──────────> 1.6

1.7 (after 1.2 schema is final)
```

### Phase 2: Feature Parity + Deploy

**Goal:** All existing features working on Cloudflare, old deployments retired.

#### Task 2.1: Deploy unified worker to preview
- Set up wrangler.toml with preview environment
- Create D1 preview database
- Create R2 preview buckets
- Deploy and smoke test
- **Est:** ~100 lines config, **Size:** S

#### Task 2.2: Migrate blog frontend to unified worker
- Update Astro config for unified deployment
- Remove remote auth verification (use local DB)
- Test SSR on `blog.devpad.tools`
- **Est:** ~200 lines, **Size:** M

#### Task 2.3: Migrate media-timeline frontend to unified worker  
- Update Astro config for unified deployment
- Remove remote auth verification
- Test SSR on `media.devpad.tools`
- Migrate cron handler
- **Est:** ~200 lines, **Size:** M
- **Parallel with 2.2**

#### Task 2.4: Migrate devpad frontend
- Update Astro config for Cloudflare Pages or Worker assets
- Remove SSR handler from Bun server
- Test SSR on `devpad.tools`
- **Est:** ~300 lines, **Size:** M

#### Task 2.5: Production data migration
- Backup all production data
- Run D1 migration with production data
- Verify migrated data
- Set up DNS records
- **Est:** ~50 lines scripts, **Size:** S (but high risk)

#### Task 2.6: DNS cutover and monitoring
- Point `devpad.tools`, `blog.devpad.tools`, `media.devpad.tools` to Worker
- Monitor error rates
- Keep VPS running as fallback for 1 week
- **Size:** S

#### Task 2.7: Retire VPS
- Decommission Docker deployment
- Archive old deployment configs
- Update CI/CD pipelines
- **Size:** S

### Phase 3: Enhancements

**Goal:** New features enabled by the unified architecture.

#### Task 3.1: Adopt @f0rbit/corpus for scan results
- Store scan results as corpus snapshots instead of raw JSON
- Enable version comparison of scan results
- **Est:** ~200 lines, **Size:** M

#### Task 3.2: Adopt @f0rbit/corpus Result types in devpad core
- Replace custom `@devpad/api/result.ts` with `@f0rbit/corpus` Result/pipe
- Refactor core services to use pipe() patterns
- **Est:** ~400 lines (refactor), **Size:** M

#### Task 3.3: Cross-project features
- Blog posts linked to devpad project milestones
- Timeline showing blog post publications alongside task completions
- Unified activity feed across all three platforms
- **Est:** ~500 lines, **Size:** L

#### Task 3.4: UI consolidation
- Migrate devpad frontend to @f0rbit/ui components
- Standardize design system across all three apps
- **Est:** ~800 lines (incremental), **Size:** XL

#### Task 3.5: GitHub webhook-based scanning
- Instead of manual scan initiation, use GitHub webhooks
- Worker receives push events, triggers scan automatically
- **Est:** ~300 lines, **Size:** M

#### Task 3.6: Incremental scanning
- Use GitHub API to detect changed files since last scan
- Only scan modified files
- Much faster scans for large repos
- **Est:** ~200 lines, **Size:** M

---

## 6. Technical Decisions Needed

### Decision 1: Auth System Migration

**Context:** Lucia uses Node.js-specific APIs. Workers have Web Crypto but not `node:crypto`.

| Option | Pros | Cons | Recommendation |
|--------|------|------|----------------|
| **A: Port Lucia to D1** | Minimal code changes, familiar API | Lucia may not support D1, may need Node.js compat | Research first |
| **B: Custom session management** | Full control, lightweight, Workers-native | More code to write and maintain | **Recommended** |
| **C: Use Cloudflare Access** | Zero custom auth code | Less flexible, vendor lock-in | Not suitable for OAuth |

**Recommendation: B** — Write a minimal session manager. The current auth is already partially custom (JWT, API keys). Lucia is only used for session cookie management. A custom solution using D1 directly is ~200 lines and fully Workers-native.

**Decision required before: Phase 1 Task 1.3**

### Decision 2: Single Worker vs Multiple Workers

| Option | Pros | Cons |
|--------|------|------|
| **A: Single Worker** | Shared auth (no network hops), simpler deployment, single codebase | Larger bundle, blast radius, all-or-nothing deploys |
| **B: Multiple Workers with Service Bindings** | Isolation, independent deploys, smaller bundles | Auth needs service binding call, more config |
| **C: Single Worker for API + Pages per frontend** | API isolation, static files on CDN | More moving parts |

**Recommendation: A for now** — Start with a single worker. The combined codebase isn't that large. If bundle size becomes an issue or deploy isolation is needed, refactor to service bindings later.

### Decision 3: Frontend Hosting

| Option | Pros | Cons |
|--------|------|------|
| **A: Worker Assets (all-in-one)** | Single deployment, SSR easy | Larger worker, asset serving overhead |
| **B: Cloudflare Pages per app** | CDN-optimized static, separate deploys | Need proxy for API calls, more config |
| **C: Worker API + Pages static + Worker SSR** | Best of both worlds | Most complex setup |

**Recommendation: A** — Start with Worker Assets. This is what dev-blog and media-timeline already use. devpad SSR is the only new addition.

### Decision 4: Database Merging Strategy

| Option | Pros | Cons |
|--------|------|------|
| **A: Single D1 database** | Shared auth tables, simple joins, one migration set | Table namespace pollution, harder to reason about |
| **B: Separate D1 databases** | Clean separation, independent migrations | Auth data needs duplication or service binding |

**Recommendation: A** — Tables are already namespaced. Auth must be shared. Single DB is simpler.

### Decision 5: GitHub API vs Repo Download for Scanning

| Option | Pros | Cons |
|--------|------|------|
| **A: GitHub Trees + Contents API** | Workers-compatible, no filesystem needed, selective fetch | Rate limits, slower for large repos, base64 overhead |
| **B: Download zip to R2, process via Durable Object** | Full repo access, no API rate limits | Complex, Durable Object costs, still needs parsing |
| **C: GitHub Actions + webhook** | Scanning runs in GitHub infra, no rate limits | More complex setup per repo, external dependency |

**Recommendation: A** for MVP, with **C** as Phase 3 enhancement. The GitHub API approach works for typical repos. For very large repos, a GitHub Action that runs the scanner and posts results back would be more scalable.

---

## 7. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| D1 migration data loss | Low | Critical | Full backup before migration, keep VPS running |
| GitHub API rate limits during scanning | Medium | Medium | Implement caching, consider GitHub App for higher limits |
| Auth migration breaks existing sessions | Medium | High | Gradual rollout, keep VPS as fallback |
| Worker bundle size too large | Low | Medium | Tree-shaking, lazy imports, service binding refactor |
| Cloudflare D1 performance (cold starts) | Medium | Low | D1 is improving, monitor latency |
| Breaking `@devpad/api` npm consumers | Medium | Medium | Version bump, maintain backwards compatibility for API shape |

---

## 8. Effort Summary

| Phase | Tasks | Estimated Lines | Duration (1 engineer) |
|-------|-------|-----------------|-----------------------|
| Phase 1: Foundation | 8 tasks | ~2,750 | 3-4 weeks |
| Phase 2: Feature Parity | 7 tasks | ~1,050 | 2 weeks |
| Phase 3: Enhancements | 6 tasks | ~2,400 | 4-6 weeks (incremental) |
| **Total** | **21 tasks** | **~6,200** | **9-12 weeks** |

### Critical Path

```
Schema migration (1.2) → Auth migration (1.3) → Service port (1.4) → Unified worker (1.6) → Integration tests (1.8) → Preview deploy (2.1) → Production migration (2.5)
```

The todo-tracker rewrite (1.5) can proceed in parallel with the database/auth migration, which is the biggest de-risking opportunity.

### Parallelizable Work

**Phase 1 parallel tracks:**
- Track A: Schema + Auth + Core services (1.1 → 1.2 → 1.3 → 1.4)
- Track B: Scanner rewrite (1.5)
- These merge at Task 1.6 (unified worker)

**Phase 2 parallel tracks:**
- Track A: Blog frontend migration (2.2)
- Track B: Media frontend migration (2.3)
- Track C: devpad frontend migration (2.4)
- All three can proceed in parallel after 2.1

---

## 9. Breaking Changes & Callouts

### Breaking Changes

1. **`@devpad/api` npm package**: The API shape should remain the same (same routes, same responses), but the base URL will change from VPS to `devpad.tools` (Cloudflare). Existing consumers using `devpad.tools` domain won't notice.

2. **Session cookies**: Migrating from Lucia to custom sessions will invalidate all existing sessions. Users will need to re-login. This is a **one-time** disruption.

3. **Scanning behavior**: The TypeScript scanner may produce slightly different results than the Go binary (whitespace handling, context line counts). Tests should verify parity.

4. **forbit-astro (personal site)**: Located at `~/dev/forbit-astro`, this appears to be a separate Astro site that may consume devpad's API. Need to verify it won't break during migration.

### Non-Breaking

- All API paths remain the same
- Database schema is additive (new tables, no removed columns)
- Frontend components and pages remain the same
- `@devpad/mcp` and `@devpad/cli` packages should work unchanged (they use `@devpad/api` client)
