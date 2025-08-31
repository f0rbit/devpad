# Devpad Restructuring Plan

## Overview
Large-scale code restructuring to prepare for API decoupling. The goal is to separate business logic from the Astro app and create a clean, maintainable architecture where the API and app can operate independently.

## Current Issues
1. **Duplicate Type Definitions**: Same types defined in both `app/src/server/types.ts` and `schema/src/types.ts`
2. **Tightly Coupled Business Logic**: Core business logic embedded in Astro app at `app/src/server/`
3. **Inconsistent Database Access**: Mixed patterns between direct DB access and HTTP client usage
4. **Type System Fragmentation**: Zod schemas and TypeScript types scattered across packages

## Restructuring Phases

### Phase 1: Extract Core Business Logic
Create a new `packages/core/` package containing all shared business logic:

```
packages/
  core/                    # NEW - Shared business logic
    src/
      services/            # Business logic from app/src/server/
        projects.ts        # Project CRUD operations
        tasks.ts           # Task/todo operations  
        tags.ts            # Tag management
        github.ts          # GitHub integration
      auth/                # Authentication logic
        keys.ts            # API key management
        lucia.ts           # Lucia auth setup
      data/                # Data access abstraction
        adapters/
          database.ts      # Direct DB adapter
          api-client.ts    # HTTP API adapter
        interfaces.ts      # Data service contracts
      types/               # Internal core types
        index.ts
    package.json
    tsconfig.json
```

### Phase 2: Consolidate Type System
- **Remove**: `packages/app/src/server/types.ts` (145 lines of duplicated types)
- **Enhance**: `packages/schema/src/types.ts` as single source of truth
- **Standardize**: All Zod schemas in `packages/schema/src/validation.ts`
- **Export**: Clean type exports from `@devpad/schema`

#### Type Consolidation Map:
- `UpsertProject`, `UpsertTodo`, `UpsertTag` → `@devpad/schema`
- `UpdateData`, `UpdateAction` → `@devpad/schema`  
- `TAG_COLOURS`, `TagColor` → `@devpad/schema`
- `ApiClientConfig`, `RequestOptions` → `@devpad/schema`

### Phase 3: Create Data Access Abstraction
Abstract data operations behind interfaces to enable switching between database and HTTP modes:

```typescript
// packages/core/src/data/interfaces.ts
export interface DataAdapter {
  projects: ProjectService;
  tasks: TaskService;  
  tags: TagService;
  auth: AuthService;
}

export interface ProjectService {
  getUserProjects(userId: string): Promise<Project[]>;
  getProject(userId: string, projectId: string): Promise<{project: Project | null, error: string | null}>;
  upsertProject(data: UpsertProject, userId: string, accessToken?: string): Promise<Project>;
  // ... other project methods
}

// Similar interfaces for TaskService, TagService, AuthService
```

#### Implementation Strategy:
- **DatabaseAdapter**: Direct database access using Drizzle (current behavior)
- **ApiClientAdapter**: HTTP requests using existing API client (future state)
- **Factory Pattern**: Environment-based adapter selection

### Phase 4: Update Package Dependencies
New dependency structure:
```
app (Astro frontend)
├── @devpad/core       # Business logic
├── @devpad/schema     # Types and validation
└── @devpad/api        # HTTP client (post-decoupling)

core (Business logic)
├── @devpad/schema     # Types and validation
└── drizzle-orm        # Database access

api (HTTP client)
└── @devpad/schema     # Types and validation

schema (Types/DB)
├── drizzle-orm        # Database schema
└── zod               # Validation
```

### Phase 5: Migration Strategy
Implement feature flags for gradual migration:

```typescript
// Environment-based data adapter selection
const dataAdapter = process.env.USE_API_CLIENT === 'true' 
  ? new ApiClientAdapter(apiConfig)
  : new DatabaseAdapter(dbConfig);
```

## Implementation Steps

### Step 1: Type Audit and Consolidation
1. Compare `app/src/server/types.ts` vs `schema/src/types.ts`
2. Identify conflicts and create master type list
3. Move all types to `@devpad/schema`
4. Remove duplicate definitions

### Step 2: Create Core Package
1. Create `packages/core/` structure
2. Set up package.json with proper dependencies
3. Configure TypeScript build

### Step 3: Extract Business Logic
1. Move files from `app/src/server/` to `core/src/services/`
2. Update imports to use `@devpad/schema` types
3. Remove database coupling where possible

### Step 4: Create Data Abstraction
1. Define service interfaces
2. Implement DatabaseAdapter (maintains current functionality)
3. Create factory for adapter selection

### Step 5: Update App Integration
1. Replace direct server imports with core package imports
2. Update API routes to use core services
3. Test functionality remains unchanged

### Step 6: Prepare API Package
1. Update API client to match core service interfaces
2. Create ApiClientAdapter implementation
3. Add environment-based switching

## Success Criteria
- [ ] All type definitions consolidated in `@devpad/schema`
- [ ] Business logic moved to `@devpad/core`
- [ ] App functionality unchanged after restructuring  
- [ ] Clear separation between database and HTTP access patterns
- [ ] All tests passing
- [ ] Clean package dependency graph
- [ ] Environment-based adapter switching working

## Benefits After Restructuring
1. **Clean Separation**: Business logic independent of frontend framework
2. **Reduced Duplication**: Single source of truth for types and validation
3. **Easy API Decoupling**: Switch from database to HTTP access via configuration
4. **Better Testability**: Business logic can be tested independently
5. **Improved Maintainability**: Clear package boundaries and responsibilities
6. **Future-Proof Architecture**: Ready for microservices or different frontends

## Risks and Mitigation
- **Risk**: Breaking changes during migration
  - **Mitigation**: Incremental migration with comprehensive testing
- **Risk**: Import path changes affecting many files
  - **Mitigation**: Use find/replace tools and TypeScript compiler for validation
- **Risk**: Performance impact from abstraction
  - **Mitigation**: Keep adapters lightweight, measure before/after performance

---
*This plan prioritizes maintainability and clean architecture to support future API decoupling and system growth.*