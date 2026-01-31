# Blog & Media API Client Extension

## Executive Summary

Converge `@devpad/api` onto `@f0rbit/corpus` Result types (Phase 0), then add blog and media namespaces so all consumers can make typesafe calls through a single shared client (Phases 1-3). The corpus migration is a **breaking change** to every consumer of the API client -- all destructuring patterns change from `const { project, error } = ...` to checking `result.ok` and accessing `result.value`.

**Estimated total LOC:** ~2,200 (800 migration + 1,400 new)
**Breaking changes:** Phase 0 changes every API client return type. All consumers must update.

## Current vs Target State

### Current: Custom Result
```typescript
type Result<TData, TName extends string> = Success<TData, TName> | Failure<TName>
// Usage: const { project, error } = await client.projects.find(id)
```

### Target: Corpus Result
```typescript
type Result<T, E = ApiError> = { ok: true; value: T } | { ok: false; error: E }
// Usage: const result = await client.projects.find(id)
//        if (!result.ok) { /* handle result.error */ }
//        result.value // the project
```

## Error Type Design

Use a plain `ApiError` interface (not the existing class) as the E parameter. This keeps the same error shape consumers already access:

```typescript
// packages/api/src/result.ts
export type ApiResultError = {
    message: string;
    code?: string;
    status_code?: number;
};

export type ApiResult<T> = Result<T, ApiResultError>;
```

This is separate from the `ApiError` class in `errors.ts` which is used for throwing inside `HttpClient`/`request.ts`. The `wrap()` function catches those thrown errors and converts them into corpus `err()` values.

## Integration Point Analysis

### Affected Packages

| Package | Change Type | Files |
|---------|------------|-------|
| `@devpad/api` | **Primary** -- Result type swap, all method signatures | 4 files |
| `apps/main` | **Consumer** -- destructuring pattern changes | 7 files |
| `tests/integration` | **Consumer** -- destructuring pattern changes | ~12 files + shared utils |
| `tests/shared` | **Consumer** -- base test class + assertions | 2-3 files |

### NOT Affected
- `packages/core/`, `packages/schema/`, `packages/worker/` -- already use corpus Result
- `packages/mcp/`, `packages/cli/` -- consume tools.ts which unwraps internally

---

## Phase 0: Corpus Result Migration

### Phase 0A: Core API Package (sequential, single agent)

**Files touched:**
- `packages/api/package.json` -- add `@f0rbit/corpus` dependency
- `packages/api/src/result.ts` -- rewrite (67 lines → ~25 lines)
- `packages/api/src/api-client.ts` -- update all return types + internal self-calls (~478 lines, ~60 changes)
- `packages/api/src/index.ts` -- update exports (~21 lines)

**Estimated LOC changed:** ~300

**Dependencies:** None

#### Task 0A-1: Add corpus dependency

```bash
# In packages/api/
bun add @f0rbit/corpus
```

#### Task 0A-2: Rewrite `result.ts`

**Before:**
```typescript
export type Success<TData, TName extends string> = { [K in TName]: TData } & { error: null };
export type Failure<TName extends string> = { [K in TName]: null } & { error: { message: string; code?: string; status_code?: number } };
export type Result<TData, TName extends string> = Success<TData, TName> | Failure<TName>;

export function wrap<TData, TName extends string>(fn: () => Promise<TData>, data_name: TName): Promise<Result<TData, TName>> {
    return fn()
        .then(data => { ... })
        .catch(error => { ... });
}
```

**After:**
```typescript
import { ok, err, type Result } from "@f0rbit/corpus";

export type ApiResultError = {
    message: string;
    code?: string;
    status_code?: number;
};

export type ApiResult<T> = Result<T, ApiResultError>;

export function wrap<T>(fn: () => Promise<T>): Promise<ApiResult<T>> {
    return fn()
        .then(data => ok(data))
        .catch(error => err({
            message: error.message || "Unknown error",
            code: error.code,
            status_code: error.statusCode || error.status_code,
        }));
}

export { ok, err, type Result } from "@f0rbit/corpus";
```

Key changes:
- Remove `TName` generic -- no longer needed (corpus Result uses `.value` not dynamic keys)
- Remove `data_name` parameter from `wrap()` -- no longer needed
- `wrap()` returns `ApiResult<T>` (alias for `Result<T, ApiResultError>`)
- Re-export `ok`, `err`, `Result` from corpus for convenience

#### Task 0A-3: Update `api-client.ts`

Every method signature changes. The transformation is mechanical:

**Return types:**
```typescript
// Before
find: (id: string): Promise<Result<Project | null, "project">>
// After
find: (id: string): Promise<ApiResult<Project | null>>
```

**wrap() calls -- remove second argument:**
```typescript
// Before
wrap(() => this.clients.projects.get<Project>("/projects", { query: { id } }), "project")
// After
wrap(() => this.clients.projects.get<Project>("/projects", { query: { id } }))
```

**Internal self-calls (methods that call other methods on `this`):**
```typescript
// Before (api-client.ts:77-78)
const { projects, error } = await this.projects.list(filters);
if (error) throw new Error(error.message);
return projects!.reduce(...)

// After
const result = await this.projects.list(filters);
if (!result.ok) throw new Error(result.error.message);
return result.value.reduce(...)
```

```typescript
// Before (api-client.ts:125-127)
const { project, error } = await this.projects.find(id);
if (error) throw new Error(error.message);
if (!project) throw new Error(`Project with id ${id} not found`);

// After
const result = await this.projects.find(id);
if (!result.ok) throw new Error(result.error.message);
if (!result.value) throw new Error(`Project with id ${id} not found`);
```

Note: the `throw` inside `wrap()` callbacks is fine -- `wrap()` catches it and converts to `err()`.

**Import changes:**
```typescript
// Before
import { type Result, wrap } from "./result";
// After
import { type ApiResult, wrap } from "./result";
```

#### Task 0A-4: Update `index.ts` exports

```typescript
// Before
export { wrap, type Result, type Success, type Failure } from "./result";
// After
export { wrap, ok, err, type ApiResult, type ApiResultError, type Result } from "./result";
```

Remove `Success` and `Failure` exports (no longer exist). Add `ok`, `err`, `ApiResult`, `ApiResultError`.

---

### Phase 0B: Tool Definitions (sequential, single agent)

**Files touched:**
- `packages/api/src/tools.ts` (~444 lines, 28 tools)

**Estimated LOC changed:** ~80

**Dependencies:** Phase 0A

The transformation in tools.ts is uniform across all 28 tools:

**Before (every tool):**
```typescript
execute: async (client, input) => {
    const result = await client.projects.list(input);
    if (result.error) throw new Error(result.error.message);
    return result.projects;
},
```

**After:**
```typescript
execute: async (client, input) => {
    const result = await client.projects.list(input);
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
},
```

Pattern: `result.error` → `!result.ok`, `result.<name>` → `result.value`.

Every tool follows this exact pattern. The agent should do a search-and-replace pass:
1. `if (result.error)` → `if (!result.ok)`
2. `result.<dynamic_name>` → `result.value` (each tool accesses a different property name like `result.projects`, `result.task`, `result.project`, etc.)

---

### Phase 0C: Frontend Consumer Updates (sequential, single agent)

**Files touched:**
- `apps/main/src/components/solid/OptimisticTaskProgress.tsx` (~1 call site)
- `apps/main/src/components/solid/SpecificationEditor.tsx` (~1 call site)
- `apps/main/src/components/solid/TaskEditor.tsx` (~1 call site)
- `apps/main/src/components/solid/TaskCard.tsx` (~1 call site)
- `apps/main/src/components/solid/GoalSelector.tsx` (~2 call sites)
- `apps/main/src/components/solid/GoalQuickForm.tsx` (~2 call sites)
- `apps/main/src/utils/api-client.ts` (~1 `rethrow` helper)

**Estimated LOC changed:** ~60

**Dependencies:** Phase 0A

The transformation pattern for frontend components:

**Before:**
```typescript
const { milestones, error } = await api_client.milestones.getByProject(project_id);
if (error) {
    console.error("Failed to load milestones and goals:", error);
    setMilestones([]);
    ...
}
// use milestones directly
```

**After:**
```typescript
const result = await api_client.milestones.getByProject(project_id);
if (!result.ok) {
    console.error("Failed to load milestones and goals:", result.error);
    setMilestones([]);
    ...
}
// use result.value
```

**`rethrow` helper (`apps/main/src/utils/api-client.ts:227`):**

**Before:**
```typescript
export function rethrow<T>(error: Result<T, string>["error"]) {
    return new Response(error?.code, { status: error?.status_code, statusText: error?.code });
}
```

**After:**
```typescript
export function rethrow(error: ApiResultError) {
    return new Response(error?.code, { status: error?.status_code, statusText: error?.code });
}
```

Import `ApiResultError` from `@devpad/api`. Callers will change from `rethrow(error)` (where `error` came from destructuring) to `rethrow(result.error)`.

---

### Phase 0D: Integration Test Updates (sequential, single agent)

**Files touched:**
- `tests/shared/base-integration-test.ts` (~6 call sites)
- `tests/integration/projects.test.ts`
- `tests/integration/tasks.test.ts`
- `tests/integration/milestones-goals.test.ts`
- `tests/integration/task-goal-linking.test.ts`
- `tests/integration/api-client-operations.test.ts`
- `tests/integration/clean-api-interface.test.ts`
- `tests/integration/api-key-management.test.ts`
- `tests/integration/project-edge-cases.test.ts`
- `tests/integration/user-preferences.test.ts`
- `tests/integration/scanning-api-client.test.ts`
- `tests/integration/mcp-extended-tools.test.ts`
- `tests/integration/mcp-server.test.ts`
- `tests/integration/core-scanning-workflows.test.ts`

**Estimated LOC changed:** ~300

**Dependencies:** Phase 0A

The transformation is the same everywhere:

**Before:**
```typescript
const { projects, error } = await testInstance.client.projects.list();
if (error) {
    throw new Error(`Failed to list projects: ${error.message}`);
}
expectValidArray(projects!, expectValidProject);
```

**After:**
```typescript
const result = await testInstance.client.projects.list();
if (!result.ok) {
    throw new Error(`Failed to list projects: ${result.error.message}`);
}
expectValidArray(result.value, expectValidProject);
```

**`base-integration-test.ts` helper methods:**

**Before:**
```typescript
public async createAndRegisterProject(project_data: any): Promise<Project> {
    const { project, error } = await this.client.projects.create(project_data);
    if (error) {
        throw new Error(`Failed to create project: ${error.message}`);
    }
    this.registerProject(project!);
    return project!;
}
```

**After:**
```typescript
public async createAndRegisterProject(project_data: any): Promise<Project> {
    const result = await this.client.projects.create(project_data);
    if (!result.ok) {
        throw new Error(`Failed to create project: ${result.error.message}`);
    }
    this.registerProject(result.value);
    return result.value;
}
```

No more `!` non-null assertions needed -- `result.value` is guaranteed non-null when `result.ok` is true.

**Assertion helpers (`tests/shared/assertions.ts`):**
Check if `expectValidApiError` or similar helpers reference the old error shape. If so, update them to check `result.ok === false` and `result.error` matching `ApiResultError` shape.

---

### Phase 0 Verification

After all Phase 0 sub-tasks complete, a single verification agent should:

1. `bun check` (typecheck) in `apps/main`
2. `bun build` in `packages/api`
3. `make unit` -- run unit tests
4. `make integration` -- run full integration suite
5. Fix any issues
6. Commit atomically: "refactor: converge @devpad/api onto corpus Result types"

---

## Phase 0 Execution Strategy

```
Phase 0A: Core API package (sequential, single agent)
├── Add @f0rbit/corpus dependency
├── Rewrite result.ts
├── Update api-client.ts (all methods + internal self-calls)
├── Update index.ts exports
→ Quick typecheck of packages/api only

Phase 0B: Tool definitions (sequential, single agent)
├── Update all 28 tools in tools.ts
→ Depends on: Phase 0A

Phase 0C: Frontend consumers (parallel with 0B, single agent)
├── Update 6 SolidJS components
├── Update utils/api-client.ts rethrow helper
→ Depends on: Phase 0A (but NOT 0B, different files)

Phase 0D: Integration tests (parallel with 0B+0C, single agent)
├── Update base-integration-test.ts
├── Update ~12 test files
├── Update assertion helpers if needed
→ Depends on: Phase 0A (but NOT 0B/0C, different files)

→ Verification: typecheck all, run full test suite, commit
```

Note: 0B, 0C, 0D can all run in parallel since they touch completely different files. They all depend only on 0A.

---

## Phase 1: Blog + Media Client Namespaces (sequential, single agent, ~620 LOC)

### Namespace Design

All methods now return `ApiResult<T>` (corpus Result):

#### Blog Namespace (`client.blog.*`)

```
client.blog.posts.list(params?)        → ApiResult<PostsResponse>
client.blog.posts.getBySlug(slug)      → ApiResult<Post>
client.blog.posts.create(data)         → ApiResult<Post>
client.blog.posts.update(uuid, data)   → ApiResult<Post>
client.blog.posts.delete(uuid)         → ApiResult<{ success: boolean }>
client.blog.posts.versions(uuid)       → ApiResult<{ versions: VersionInfo[] }>
client.blog.posts.version(uuid, hash)  → ApiResult<PostContent>
client.blog.posts.restore(uuid, hash)  → ApiResult<Post>

client.blog.tags.list()                → ApiResult<{ tags: TagWithCount[] }>
client.blog.tags.getForPost(uuid)      → ApiResult<{ tags: string[] }>
client.blog.tags.setForPost(uuid, tags)→ ApiResult<{ tags: string[] }>
client.blog.tags.addToPost(uuid, tags) → ApiResult<{ tags: string[] }>
client.blog.tags.removeFromPost(uuid, tag) → ApiResult<void>

client.blog.categories.tree()          → ApiResult<{ categories: Category[] }>
client.blog.categories.create(data)    → ApiResult<Category>
client.blog.categories.update(name, data) → ApiResult<Category>
client.blog.categories.delete(name)    → ApiResult<void>

client.blog.tokens.list()              → ApiResult<{ tokens: SanitizedToken[] }>
client.blog.tokens.create(data)        → ApiResult<CreatedToken>
client.blog.tokens.update(id, data)    → ApiResult<AccessKey>
client.blog.tokens.delete(id)          → ApiResult<void>
```

#### Media Namespace (`client.media.*`)

```
client.media.profiles.list()                        → ApiResult<Profile[]>
client.media.profiles.create(data)                  → ApiResult<Profile>
client.media.profiles.get(id)                       → ApiResult<Profile>
client.media.profiles.update(id, data)              → ApiResult<Profile>
client.media.profiles.delete(id)                    → ApiResult<{ success: boolean }>
client.media.profiles.filters.list(profile_id)      → ApiResult<ProfileFilter[]>
client.media.profiles.filters.add(profile_id, data) → ApiResult<ProfileFilter>
client.media.profiles.filters.remove(profile_id, filter_id) → ApiResult<void>
client.media.profiles.timeline(slug, params?)       → ApiResult<Timeline>

client.media.connections.list(profile_id)            → ApiResult<Account[]>
client.media.connections.create(data)                → ApiResult<Account>
client.media.connections.delete(account_id)          → ApiResult<{ success: boolean }>
client.media.connections.refresh(account_id)         → ApiResult<any>
client.media.connections.refreshAll()                → ApiResult<any>
client.media.connections.updateStatus(account_id, is_active) → ApiResult<Account>
client.media.connections.settings.get(account_id)    → ApiResult<PlatformSettings>
client.media.connections.settings.update(account_id, settings) → ApiResult<any>
client.media.connections.repos(account_id)           → ApiResult<any[]>
client.media.connections.subreddits(account_id)      → ApiResult<any[]>

client.media.credentials.check(platform, profile_id) → ApiResult<{ exists: boolean; isVerified: boolean; clientId: string | null }>
client.media.credentials.save(platform, data)        → ApiResult<{ success: boolean; id: string }>
client.media.credentials.delete(platform, profile_id) → ApiResult<{ success: boolean }>

client.media.timeline.get(user_id, params?)          → ApiResult<Timeline>
client.media.timeline.getRaw(user_id, platform, account_id) → ApiResult<any>
```

### Task 1A: Blog + Media namespaces in api-client.ts
- **File:** `packages/api/src/api-client.ts`
- **LOC:** ~600
- **Dependencies:** Phase 0A complete
- **Details:**
  - Import blog types from `@devpad/schema/blog`
  - Import media types from `@devpad/schema/media`
  - Add `blog` and `media` HttpClient categories to constructor
  - Add `public readonly blog = { posts: {...}, tags: {...}, categories: {...}, tokens: {...} }` namespace
  - Add `public readonly media = { profiles: {...}, connections: {...}, credentials: {...}, timeline: {...} }` namespace
  - All methods use `wrap(() => ...)` (single arg, no name param)
  - Blog paths: `/blog/posts`, `/blog/tags`, `/blog/categories`, `/blog/tokens`
  - Media paths: `/profiles`, `/connections`, `/credentials`, `/timeline`

### Task 1B: Update exports in index.ts
- **File:** `packages/api/src/index.ts`
- **LOC:** ~20
- **Dependencies:** Task 1A
- **Details:** Re-export blog and media types from `@devpad/schema/blog` and `@devpad/schema/media`

**→ Verification: typecheck, commit**

---

## Phase 2: Tool Definitions (sequential, single agent, ~400 LOC)

### Task 2A: Blog tool definitions
- **File:** `packages/api/src/tools.ts`
- **LOC:** ~200
- **Dependencies:** Phase 1
- **Details:**
  - Tools: `devpad_blog_posts_list`, `devpad_blog_posts_get`, `devpad_blog_posts_create`, `devpad_blog_posts_update`, `devpad_blog_posts_delete`, `devpad_blog_tags_list`, `devpad_blog_categories_tree`, `devpad_blog_categories_create`, `devpad_blog_tokens_list`, `devpad_blog_tokens_create`
  - Import blog Zod schemas from `@devpad/schema/blog`
  - All tools use corpus pattern: `if (!result.ok) throw new Error(result.error.message); return result.value;`

### Task 2B: Media tool definitions
- **File:** `packages/api/src/tools.ts`
- **LOC:** ~200
- **Dependencies:** Task 2A (same file, must be sequential)
- **Details:**
  - Tools: `devpad_media_profiles_list`, `devpad_media_profiles_create`, `devpad_media_profiles_get`, `devpad_media_profiles_update`, `devpad_media_profiles_delete`, `devpad_media_connections_list`, `devpad_media_connections_refresh`, `devpad_media_timeline_get`
  - Import media Zod schemas from `@devpad/schema/media`

**→ Verification: typecheck, commit**

---

## Phase 3: Integration Tests (parallel, two agents, ~300 LOC)

### Task 3A: Blog API client integration tests
- **File:** `tests/integration/blog-api-client.test.ts` (new)
- **LOC:** ~150
- **Dependencies:** Phases 1-2
- **Parallel:** Yes (different file from 3B)
- **Details:**
  - Test post CRUD lifecycle via `client.blog.posts.*`
  - Test category CRUD via `client.blog.categories.*`
  - Test blog tags operations via `client.blog.tags.*`
  - Test token CRUD via `client.blog.tokens.*`
  - Uses `setupBaseIntegrationTest()` pattern
  - All assertions use corpus pattern: `expect(result.ok).toBe(true); if (result.ok) { ... result.value ... }`

### Task 3B: Media API client integration tests
- **File:** `tests/integration/media-api-client.test.ts` (new)
- **LOC:** ~150
- **Dependencies:** Phases 1-2
- **Parallel:** Yes (different file from 3A)
- **Details:**
  - Test profile CRUD lifecycle via `client.media.profiles.*`
  - Test profile filters via `client.media.profiles.filters.*`
  - Test connections list and timeline retrieval

**DECISION NEEDED:** Integration test setup may not initialize blog/media contexts (corpus DB, encryption keys, etc.) for the test environment. Recommend starting with operations that don't need external context (profiles, posts, categories) and noting the rest as future work.

**→ Verification: typecheck, run full test suite, commit**

---

## Revised Execution Plan

```
Phase 0A: Core API package rewrite (sequential, 1 agent)
├── Add @f0rbit/corpus dependency to packages/api
├── Rewrite result.ts (remove custom types, use corpus)
├── Update all api-client.ts method signatures + internals
├── Update index.ts exports

Phase 0B+0C+0D: Consumer updates (parallel, 3 agents)
├── Agent A: tools.ts -- 28 tool error checks + value access
├── Agent B: Frontend components -- 7 files in apps/main/src/
├── Agent C: Integration tests -- base-integration-test.ts + ~12 test files
→ Verification: typecheck all, full test suite, commit

Phase 1: Blog + Media Client (sequential, 1 agent)
├── Blog namespace in api-client.ts
├── Media namespace in api-client.ts
├── Export updates in index.ts
→ Verification: typecheck, commit

Phase 2: Tool Definitions (sequential, 1 agent)
├── Blog tools in tools.ts
├── Media tools in tools.ts
→ Verification: typecheck, commit

Phase 3: Integration Tests (parallel, 2 agents)
├── Agent A: Blog integration tests (new file)
├── Agent B: Media integration tests (new file)
→ Verification: typecheck, full test suite, commit
```

## Risk Assessment

1. **Blast radius of Phase 0:** Every consumer of `@devpad/api` changes. Mitigation: full test suite runs after Phase 0.
2. **Internal self-calls in api-client.ts:** Methods like `projects.map()` and `projects.update()` call other methods on `this` and destructure the result. These must be carefully updated. There are ~5 such call sites.
3. **Non-null assertions:** The old pattern required `projects!` after error check. Corpus Result eliminates this -- `result.value` is typed correctly when `result.ok` is true. This is an improvement.
4. **error-handlers.ts:** This file uses `throw` patterns internally (for `HttpClient` error handling). It does NOT need changes -- `wrap()` catches these throws and converts to corpus `err()`. The file stays as-is.

## Implementation Notes

### HttpClient Category Strategy

Blog routes mount at `/api/v1/blog/*`, media routes at `/api/v1/*`:

```typescript
this.clients = {
    // existing...
    blog: new HttpClient({ ...clientOptions, category: "blog" }),
    media: new HttpClient({ ...clientOptions, category: "media" }),
};
```

Blog paths: `/blog/posts`, `/blog/tags`, `/blog/categories`, `/blog/tokens`
Media paths: `/profiles`, `/connections`, `/credentials`, `/timeline`

### Response Shape Nuances

Blog routes use a `response.with()` helper that wraps results:
- Tags list → `{ tags: [...] }`
- Categories tree → `{ categories: [...] }`
- Tokens list → `{ tokens: [...] }`
- Post versions → `{ versions: [...] }`
- Posts list → `PostsResponse` directly
- Posts get → `Post` directly

### PostListParams Query String Handling

```typescript
list: (params?: Partial<PostListParams>): Promise<ApiResult<PostsResponse>> =>
    wrap(() => {
        const query: Record<string, string> = {};
        if (params?.category) query.category = params.category;
        if (params?.tag) query.tag = params.tag;
        if (params?.project) query.project = params.project;
        if (params?.status) query.status = params.status;
        if (params?.archived !== undefined) query.archived = String(params.archived);
        if (params?.limit) query.limit = String(params.limit);
        if (params?.offset !== undefined) query.offset = String(params.offset);
        if (params?.sort) query.sort = params.sort;
        return this.clients.blog.get<PostsResponse>(
            "/blog/posts",
            Object.keys(query).length ? { query } : {}
        );
    }),
```

### Tool Naming Convention

Existing: `devpad_<namespace>_<action>`. New tools:
- `devpad_blog_posts_list`, `devpad_blog_posts_get`, `devpad_blog_posts_create`, `devpad_blog_posts_update`, `devpad_blog_posts_delete`
- `devpad_blog_tags_list`, `devpad_blog_categories_tree`, `devpad_blog_categories_create`
- `devpad_blog_tokens_list`, `devpad_blog_tokens_create`
- `devpad_media_profiles_list`, `devpad_media_profiles_create`, `devpad_media_profiles_get`, `devpad_media_profiles_update`, `devpad_media_profiles_delete`
- `devpad_media_connections_list`, `devpad_media_connections_refresh`
- `devpad_media_timeline_get`

### Blog/Media App Migration (Future Work -- NOT in scope)

`apps/blog/src/lib/api.ts` and `apps/media/src/utils/api.ts` have their own fetch wrappers. Should eventually be replaced with `@devpad/api` imports but explicitly out of scope.

## Suggested AGENTS.md Updates

After this feature is implemented:

```markdown
### API Client Result Types
- `@devpad/api` uses `@f0rbit/corpus` Result types: `ApiResult<T>` is `Result<T, ApiResultError>`
- All client methods return `ApiResult<T>` -- check `result.ok`, access `result.value` or `result.error`
- The `wrap()` function in `result.ts` catches thrown errors from HttpClient and converts to corpus `err()` values
- `ApiResultError` has shape `{ message: string; code?: string; status_code?: number }`
- `error-handlers.ts` and `errors.ts` still use throw-based patterns internally (consumed by HttpClient, caught by wrap)

### API Client Architecture
- Blog routes are prefixed `/api/v1/blog/*`, media routes are at `/api/v1/*` (same base)
- Blog API responses wrap data in objects: `{ tags: [...] }`, `{ categories: [...] }`, `{ tokens: [...] }`
- Media API responses use `handleResult` which returns the value directly on success
- The `@devpad/api` client uses HttpClient categories (one per domain) with ApiResult-wrapped namespaced operations
- Tool definitions in `tools.ts` follow `devpad_<domain>_<resource>_<action>` naming
- Blog/media apps still have their own fetch wrappers -- migration to shared client is pending
```
