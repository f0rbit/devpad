# Schema and API Consolidation Analysis

**Date:** January 28, 2026  
**Status:** Analysis Complete  
**Risk Level:** Medium (some breaking changes to internal APIs)

## Executive Summary

After analyzing the devpad monorepo, I've identified several consolidation opportunities that would reduce code duplication, improve consistency, and simplify the architecture. The codebase has already undergone significant consolidation (removing separate user tables, unified auth), but there are remaining opportunities primarily in:

1. **API Key tables** - Three separate implementations that are nearly identical
2. **Error types and handling** - Four different error type definitions
3. **Crypto/Hashing utilities** - Duplicated across packages
4. **Service patterns** - Different patterns across core/blog-server/media-server
5. **Response helpers** - Already centralized but with unnecessary re-exports

The highest-impact, lowest-risk change is **unifying the API key tables**. The highest-impact, higher-risk change is **consolidating blog-server and media-server into the worker package**.

---

## 1. Schema Consolidation Opportunities

### 1.1 API Key Tables (HIGH PRIORITY)

**Current State:**
Three separate API key tables with nearly identical structures:

| Table | Package | File | Purpose |
|-------|---------|------|---------|
| `api_key` | schema | `database/schema.ts:57-60` | devpad API keys |
| `blog_access_keys` | schema | `database/blog.ts:49-57` | Blog access tokens |
| `media_api_keys` | schema | `database/media.ts:49-62` | Media API keys |

**Structural Comparison:**

```
api_key (devpad):
├── id: text (prefixed UUID)
├── owner_id: text (FK to user)
├── hash: text
├── created_at: text
├── updated_at: text
├── deleted: int (boolean)

blog_access_keys:
├── id: integer (auto-increment)
├── user_id: text
├── key_hash: text (unique)
├── name: text
├── note: text (nullable)
├── enabled: int (boolean)
├── created_at: integer (timestamp)

media_api_keys:
├── id: text (prefixed UUID)
├── user_id: text
├── key_hash: text (unique)
├── name: text (nullable)
├── last_used_at: text (nullable)
├── created_at: text
```

**Recommendation:** Unify into a single `api_key` table with a superset of features:

```typescript
export const api_key = sqliteTable("api_key", {
  ...owned_entity("api_key"),
  key_hash: text("key_hash").notNull().unique(),
  name: text("name"),
  note: text("note"),
  enabled: int("enabled", { mode: "boolean" }).notNull().default(true),
  scope: text("scope", { enum: ["devpad", "blog", "media", "all"] }).notNull().default("all"),
  last_used_at: text("last_used_at"),
});
```

**Impact:** High - reduces 3 tables to 1, simplifies auth across all apps  
**Risk:** Medium - requires migration and service updates  
**Effort:** ~200 LOC changes across 6-8 files  
**Breaking Changes:** Internal API changes only, no external API breaks

---

### 1.2 Column Naming Inconsistencies (MEDIUM PRIORITY)

**Findings:**

| Issue | Location | Pattern A | Pattern B |
|-------|----------|-----------|-----------|
| User reference | Multiple | `owner_id` | `user_id` / `author_id` |
| Timestamps | schema.ts | `text` type | blog/media use `integer` or `text` |
| Boolean columns | Multiple | `int({mode:"boolean"})` | Some use `integer` directly |
| ID format | Multiple | `text` UUID | `integer` auto-increment |

**devpad uses:**
- `owner_id` for user references
- `text` for timestamps (ISO strings)
- Prefixed UUIDs for IDs (`project_`, `task_`, etc.)

**blog uses:**
- `author_id` or `user_id` depending on table
- `integer({mode:"timestamp"})` for timestamps (Unix epoch)
- `integer` auto-increment for IDs

**media uses:**
- `user_id` for user references
- `text` for timestamps (ISO strings)
- Text UUIDs for IDs (no prefix)

**Recommendation:** Standardize on devpad's patterns:
- Always use `owner_id` (or rename devpad's `owner_id` helper for flexibility)
- Use `text` timestamps (ISO strings) everywhere
- Use prefixed text UUIDs everywhere

**Impact:** Medium - improves code consistency  
**Risk:** Medium - requires careful migration  
**Effort:** ~150 LOC schema changes, ~300 LOC service updates  
**Breaking Changes:** None if done via migration

---

### 1.3 Timestamp Column Standardization (LOW PRIORITY)

**Current patterns observed:**

```typescript
// Pattern A: devpad (schema.ts:3-6)
export const timestamps = () => ({
  created_at: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  updated_at: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
});

// Pattern B: blog (blog.ts:15-16)
created_at: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
updated_at: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),

// Pattern C: media (media.ts:16-17)
created_at: text("created_at").notNull(), // Set in application code
updated_at: text("updated_at").notNull(), // Set in application code
```

**Impact:** Low - consistency improvement  
**Risk:** Medium - requires careful migration  
**Effort:** ~100 LOC  
**Recommendation:** Defer unless doing other migrations

---

## 2. Error Types and Handling Consolidation

### 2.1 Error Type Definitions (HIGH PRIORITY)

**Current state - FOUR different error type systems:**

**A. `packages/core/src/services/errors.ts` (8 lines)**
```typescript
export type ServiceError =
  | { kind: "not_found"; entity: string; id: string }
  | { kind: "unauthorized"; message: string }
  | { kind: "database_error"; message: string }
  | { kind: "validation_error"; message: string }
  | { kind: "github_error"; message: string }
  | { kind: "scan_error"; message: string };
```

**B. `packages/core/src/auth/keys.ts:6` (inline type)**
```typescript
export type KeyError = 
  | { kind: "not_found" } 
  | { kind: "multiple_matches" } 
  | { kind: "user_not_found" } 
  | { kind: "database_error"; message: string };
```

**C. `packages/blog-server/src/utils/service-helpers.ts:3-7`**
```typescript
export type ServiceError = {
  kind: "not_found" | "db_error" | "invalid_input" | "unauthorized" | "conflict";
  message?: string;
  resource?: string;
};
```

**D. `packages/schema/src/media/errors.ts` (122 lines)** - Most comprehensive!
```typescript
export type ServiceError = 
  | NotFoundError | ForbiddenError | ValidationError | RateLimitedError 
  | StoreError | NetworkError | AuthExpiredError | ApiError 
  | ParseError | EncryptionError | DatabaseError | ConflictError | BadRequestError;
```

**E. `packages/worker/src/utils/response.ts` (131 lines)**
Has `ERROR_MAPPINGS` that maps error `kind` to HTTP status codes - used by all packages.

**Recommendation:** Adopt `@devpad/schema/media/errors.ts` as the canonical error system:
1. Move `errors.ts` to `@devpad/schema/errors.ts` 
2. Update all services to use it
3. Keep `ERROR_MAPPINGS` in worker for HTTP response handling
4. Delete redundant error definitions

**Impact:** High - single source of truth for errors  
**Risk:** Low - errors.ts already has the most complete implementation  
**Effort:** ~150 LOC changes  
**Breaking Changes:** Internal only

---

### 2.2 Response Helper Consolidation (LOW PRIORITY - Already Good)

**Current state:**
- `packages/worker/src/utils/response.ts` - The canonical implementation
- `packages/blog-server/src/utils/route-helpers.ts` - Re-exports from worker (11 lines)
- `packages/media-server/src/utils/route-helpers.ts` - Re-exports from worker (27 lines)

**This is actually fine!** The pattern of re-exporting with additional context-specific helpers is reasonable. No action needed.

---

## 3. Crypto/Utility Consolidation

### 3.1 Hashing Utilities (MEDIUM PRIORITY)

**Current state - THREE implementations:**

**A. `packages/blog-server/src/utils/crypto.ts` (17 lines)**
```typescript
const hash = async (token: string): Promise<string> => {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", data);
  return hex(hashBuffer);
};
export const hashing = { hex, hash };
```

**B. `packages/media-server/src/utils.ts` (secrets object)**
```typescript
export const secrets = {
  encrypt: encrypt_impl,  // AES-GCM encryption
  decrypt: decrypt_impl,
  sha256: sha256_impl,
  key: key_impl,  // Hashes API key
};
```

**C. `packages/core/src/auth/keys.ts:53`**
```typescript
const key_hash = crypto.randomUUID();  // Not actually hashing! Just using UUID
```

**Findings:**
- blog-server: SHA-256 hashing for tokens
- media-server: Full encryption suite (AES-GCM + SHA-256)
- core: NOT actually hashing - just using UUID as the "hash" (this is a bug/security issue!)

**Recommendation:**
1. Move crypto utilities to `@devpad/core/auth/crypto.ts`
2. Fix `core/auth/keys.ts` to actually hash the key
3. Export unified `hashing` and `secrets` objects

**Impact:** Medium - fixes potential security issue, reduces duplication  
**Risk:** Low  
**Effort:** ~100 LOC  
**Breaking Changes:** API key hash format changes (requires regenerating keys)

---

### 3.2 UUID Generation (LOW PRIORITY)

**Current patterns:**
- devpad: `crypto.randomUUID()` with prefix (`project_${uuid}`)
- blog: `crypto.randomUUID()`
- media: Custom `uuid()` wrapper around `crypto.randomUUID()`

**This is fine** - minor inconsistency, not worth changing.

---

## 4. Service Pattern Analysis

### 4.1 Service Creation Patterns (MEDIUM PRIORITY)

**Three different patterns observed:**

**Pattern A: Plain functions (core)**
```typescript
// packages/core/src/services/projects.ts
export async function getUserProjects(db: any, user_id: string): Promise<Result<Project[], ServiceError>> { ... }
export async function getProject(db: any, user_id: string, project_id: string): Promise<Result<Project, ServiceError>> { ... }
```

**Pattern B: Factory function returning object (blog-server)**
```typescript
// packages/blog-server/src/services/posts.ts
export const createPostService = ({ db, corpus }: Deps) => {
  const create = async (...) => { ... };
  const update = async (...) => { ... };
  return { create, update, getBySlug, getByUuid, list, delete: remove };
};
export type PostService = ReturnType<typeof createPostService>;
```

**Pattern C: Object with methods (media-server)**
```typescript
// packages/media-server/src/services/profiles.ts
const list = async (ctx: AppContext, uid: UserId, ...) => { ... };
const create = async (ctx: AppContext, uid: UserId, input: CreateProfileInput) => { ... };
export const profile = { list, create, get, update, delete: remove };
```

**Analysis:**
- **Pattern A** is simplest but requires passing `db` to every call
- **Pattern B** creates service instances with injected dependencies (good for testing)
- **Pattern C** is a middle ground - namespace grouping but still needs context per call

**Recommendation:** Standardize on **Pattern B** (factory functions):
- Best for dependency injection
- Best for testing (can inject mock db/corpus)
- Clear service boundaries

**Impact:** Medium - better testability  
**Risk:** Medium - significant refactoring in core  
**Effort:** ~400 LOC  
**Breaking Changes:** Internal only, but significant

---

### 4.2 Context Patterns (MEDIUM PRIORITY)

**Three different context types:**

**A. `packages/blog-server/src/context.ts`**
```typescript
export type AppContext = {
  db: DrizzleDB;
  corpus: PostsCorpus;
  jwt_secret: string;
  environment: string;
};
```

**B. `packages/media-server/src/infrastructure/context.ts`**
```typescript
export type AppContext = {
  db: DrizzleDB;
  backend: Backend;
  providerFactory: ProviderFactory;
  encryptionKey: string;
  gitHubProvider?: GitHubProviderLike;
  twitterProvider?: TwitterProviderLike;
  env?: OAuthEnvCredentials;
};
```

**C. `packages/worker/src/bindings.ts` (Hono context)**
Uses Hono's context pattern with `c.get("db")`, `c.get("user")`, etc.

**Analysis:**
- blog-server and media-server have their own `AppContext` types
- These are set as Hono variables in middleware
- Worker uses a different approach (direct Hono context)

**Recommendation:** This is acceptable for now. The sub-contexts (blog/media) encapsulate domain-specific dependencies. The worker sets these up and passes them down.

---

## 5. Package Structure Analysis

### 5.1 Should blog-server and media-server be merged into worker?

**Current structure:**
```
packages/
├── worker/           # Main Cloudflare Worker entry point, devpad routes
├── blog-server/      # Blog routes and services
├── media-server/     # Media routes and services
└── core/             # Shared devpad business logic
```

**Analysis:**

| Factor | Keep Separate | Merge into Worker |
|--------|---------------|-------------------|
| Code organization | Cleaner separation | Larger files |
| Testing | Easier isolation | Harder mocking |
| Deployment | Already deployed together | Same |
| Dependencies | Can have different deps | Shared deps only |
| Dev velocity | Work on one without affecting others | Must consider all |

**Current dependency graph:**
```
worker ──depends on──> blog-server, media-server, core, schema
blog-server ──depends on──> core, schema, worker (for response helpers)
media-server ──depends on──> core, schema, worker (for response helpers)
core ──depends on──> schema
```

**Recommendation:** **Keep separate** but consolidate shared code better:
1. Move error types to `@devpad/schema/errors.ts`
2. Move crypto utilities to `@devpad/core/auth/crypto.ts`
3. Keep response helpers in `@devpad/worker/utils/response.ts`
4. The circular-ish dependency (blog-server → worker) is actually fine since it's only utils

**Impact:** Low (keep current structure)  
**Risk:** N/A  
**Effort:** N/A

---

### 5.2 Circular/Awkward Import Patterns

**Observed:**
- `blog-server` imports from `@devpad/worker/utils/response` - OK, intentional re-use
- `media-server` imports from `@devpad/worker/utils/response` - OK, same pattern
- No actual circular dependencies detected

**The re-export pattern is fine.** The response helpers are legitimately shared infrastructure.

---

## 6. Type/Validation Consolidation

### 6.1 Branded Types (MEDIUM PRIORITY)

**Current state:**
- Only `@devpad/schema/media/branded.ts` uses branded types (`UserId`, `ProfileId`, etc.)
- devpad core doesn't use branded types at all
- blog-server doesn't use branded types

**Branded types file:**
```typescript
export type UserId = Brand<string, "UserId">;
export type AccountId = Brand<string, "AccountId">;
export type ProfileId = Brand<string, "ProfileId">;
export type ConnectionId = Brand<string, "ConnectionId">;
```

**Recommendation:** Expand branded types to all packages:
1. Move to `@devpad/schema/types/branded.ts`
2. Add `ProjectId`, `TaskId`, `MilestoneId`, `GoalId`, etc.
3. Gradually adopt in services

**Impact:** Medium - better type safety  
**Risk:** Low - additive change  
**Effort:** ~100 LOC  
**Breaking Changes:** None (types only)

---

### 6.2 Zod Schema Organization (LOW PRIORITY)

**Current structure:**
- `packages/schema/src/validation.ts` - devpad Zod schemas
- `packages/schema/src/blog/types.ts` - blog Zod schemas
- `packages/schema/src/media/` - media Zod schemas spread across files

**This is acceptable.** Each domain has its own validation schemas. Some duplication exists but it's domain-specific validation.

---

## 7. Prioritized Recommendations

### Priority 1: High Impact, Low Risk

| Task | Impact | Risk | Effort | Files |
|------|--------|------|--------|-------|
| 1.1 Consolidate error types to schema | High | Low | ~150 LOC | 6 files |
| 1.2 Fix API key hashing (security) | High | Low | ~50 LOC | 2 files |
| 1.3 Consolidate crypto utilities | Medium | Low | ~100 LOC | 4 files |

### Priority 2: High Impact, Medium Risk

| Task | Impact | Risk | Effort | Files |
|------|--------|------|--------|-------|
| 2.1 Unify API key tables | High | Medium | ~200 LOC | 8 files |
| 2.2 Add branded types for devpad | Medium | Low | ~100 LOC | 5 files |

### Priority 3: Lower Priority

| Task | Impact | Risk | Effort | Files |
|------|--------|------|--------|-------|
| 3.1 Standardize service patterns | Medium | Medium | ~400 LOC | 15+ files |
| 3.2 Column naming standardization | Medium | Medium | ~450 LOC | 10+ files |
| 3.3 Timestamp standardization | Low | Medium | ~100 LOC | 5 files |

---

## 8. Implementation Plan

### Phase 1: Error and Utility Consolidation (No Breaking Changes)

**Parallel tasks:**

**Task 1.1: Move error types to schema**
- Move `packages/schema/src/media/errors.ts` to `packages/schema/src/errors.ts`
- Update exports in `packages/schema/src/index.ts`
- Update imports in media-server
- Add missing error kinds for blog/core

**Task 1.2: Fix API key hashing security issue**
- Update `packages/core/src/auth/keys.ts` to actually hash keys
- Add migration note (existing keys will stop working)

**Task 1.3: Consolidate crypto utilities**
- Create `packages/core/src/auth/crypto.ts`
- Move hashing from blog-server
- Move secrets from media-server
- Update imports

**Verification Agent:** Run typecheck, tests, commit

### Phase 2: Schema Consolidation (Migration Required)

**Sequential tasks:**

**Task 2.1: Create unified API key table**
- Add new columns to `api_key` table
- Create migration
- Update core/auth/keys.ts
- Update blog token service
- Update media credentials service
- Delete old tables after migration verified

**Verification Agent:** Run typecheck, tests, migration, commit

### Phase 3: Type Safety Improvements (Additive)

**Parallel tasks:**

**Task 3.1: Add branded types for devpad entities**
- Create `packages/schema/src/types/branded.ts`
- Add ProjectId, TaskId, MilestoneId, GoalId, TagId
- Export from schema

**Task 3.2: Adopt branded types in core services**
- Update function signatures
- Update callers as needed

**Verification Agent:** Run typecheck, tests, commit

---

## 9. Files Changed Summary

### Phase 1 Files:
```
packages/schema/src/errors.ts (new, ~130 lines)
packages/schema/src/index.ts (modify)
packages/schema/src/media/errors.ts (delete or re-export)
packages/schema/src/media/index.ts (modify)
packages/core/src/auth/crypto.ts (new, ~100 lines)
packages/core/src/auth/keys.ts (modify)
packages/core/src/auth/index.ts (modify)
packages/blog-server/src/utils/crypto.ts (delete)
packages/blog-server/src/services/tokens.ts (modify)
packages/media-server/src/utils.ts (modify - remove duplicates)
```

### Phase 2 Files:
```
packages/schema/src/database/schema.ts (modify)
packages/schema/src/database/blog.ts (modify - remove table)
packages/schema/src/database/media.ts (modify - remove table)
packages/schema/src/database/migrate.ts (modify)
packages/core/src/auth/keys.ts (significant modify)
packages/blog-server/src/services/tokens.ts (significant modify)
packages/media-server/src/services/credentials.ts (modify)
+ migration file
```

### Phase 3 Files:
```
packages/schema/src/types/branded.ts (new)
packages/schema/src/types.ts (modify)
packages/core/src/services/projects.ts (modify signatures)
packages/core/src/services/tasks.ts (modify signatures)
packages/core/src/services/milestones.ts (modify signatures)
packages/core/src/services/goals.ts (modify signatures)
```

---

## 10. Risk Assessment

### Breaking Changes Summary:

| Change | Type | Who Affected | Mitigation |
|--------|------|--------------|------------|
| API key hashing fix | Data | Existing API keys | Communicate to users, provide regen flow |
| Unified API key table | Schema | Internal only | Migration script |
| Error type imports | Code | Internal packages | Find/replace |

### Rollback Strategy:
- All changes can be reverted via git
- Database migration should have down migration
- API key change is the only user-facing risk

---

## Appendix: Code Quality Observations

### Good Patterns Found:
- Consistent use of `Result<T, E>` from @f0rbit/corpus
- Good use of Drizzle ORM throughout
- Response helpers are well-designed
- Media-server's error system is comprehensive

### Areas for Improvement:
- Inconsistent use of `any` types (especially in core services for `db` parameter)
- Some services use `catch` blocks, others use `try_catch_async`
- Test coverage unclear (would need test analysis)

### Security Note:
The `packages/core/src/auth/keys.ts:53` issue where `crypto.randomUUID()` is stored as "hash" is a security concern - UUIDs are not hashed, meaning if the database is leaked, the API keys are immediately usable. This should be Priority 1.
