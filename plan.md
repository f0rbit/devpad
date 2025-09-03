# DevPad Code Refactoring Plan

## Overview
This plan outlines a systematic approach to reduce code complexity and lines of code in the DevPad codebase by identifying and eliminating duplication patterns.

**Target Reduction: ~670 lines (15-20% of current codebase)**

## Phase 1: High Impact Changes (Priority 1)

### 1. API Client Pattern Consolidation
**Target Reduction: ~160 lines**

**Current Issue:**
- Each client class (`ProjectsClient`, `TasksClient`, `AuthClient`, `TagsClient`) follows identical constructor + API wrapper pattern
- Repetitive boilerplate in each client file

**Solution:**
- Create `BaseClient` abstract class in `packages/api/src/utils/base-client.ts`
- Migrate all clients to extend `BaseClient`
- Consolidate common patterns like constructor, API client injection

**Files to Modify:**
- `packages/api/src/utils/base-client.ts` (new)
- `packages/api/src/clients/projects.ts`
- `packages/api/src/clients/tasks.ts`
- `packages/api/src/clients/auth.ts`
- `packages/api/src/clients/tags.ts`

### 2. Database Service Repository Pattern
**Target Reduction: ~250 lines**

**Current Issue:**
- Services (`projects.ts`, `tasks.ts`, `tags.ts`) repeat identical error handling, authorization, and CRUD patterns
- Each service has its own `getXByY`, `upsert`, `getUserX` functions with similar structure

**Solution:**
- Create `BaseRepository` class in `packages/core/src/data/base-repository.ts`
- Implement generic CRUD operations with type safety
- Migrate services to use repository pattern

**Files to Modify:**
- `packages/core/src/data/base-repository.ts` (new)
- `packages/core/src/services/projects.ts`
- `packages/core/src/services/tasks.ts`
- `packages/core/src/services/tags.ts`

## Phase 2: Medium Impact Changes (Priority 2)

### 3. Error Handling Standardization
**Target Reduction: ~80 lines**

**Current Issue:**
- API error handling scattered across multiple files with similar patterns
- Request error handling in `packages/api/src/utils/request.ts` has repetitive error mapping

**Solution:**
- Create centralized error mapping utilities
- Implement error handling middleware patterns
- Standardize error response formats

**Files to Modify:**
- `packages/api/src/utils/request.ts`
- `packages/api/src/utils/errors.ts`
- Create `packages/api/src/utils/error-handlers.ts` (new)

### 4. Form State Management Consolidation
**Target Reduction: ~120 lines**

**Current Issue:**
- `TaskEditor`, `TagEditor`, `ProjectSelector` all repeat similar form state management
- Each has its own `createSignal`, validation, save logic patterns

**Solution:**
- Create reusable form hooks/utilities for SolidJS
- Implement generic form state management patterns
- Extract common validation and save patterns

**Files to Modify:**
- Create `packages/app/src/utils/form-hooks.ts` (new)
- `packages/app/src/components/solid/TaskEditor.tsx`
- `packages/app/src/components/solid/TagEditor.tsx`

## Phase 3: Polish & Cleanup (Priority 3)

### 5. Database Field Template Consolidation
**Target Reduction: ~35 lines**

**Current Issue:**
- Repetitive field definitions across tables (created_at, updated_at, deleted, owner_id patterns)

**Solution:**
- Create field template functions or mixins
- Standardize common field patterns

**Files to Modify:**
- `packages/schema/src/database/schema.ts`
- Create `packages/schema/src/database/field-templates.ts` (new)

### 6. Test Utility Consolidation ✅ **COMPLETED**
**Target Reduction: ~25 lines**

**Current Issue:**
- Similar setup patterns between integration and unit tests
- Repeated database setup, user creation patterns
- Repetitive CRUD test patterns across integration tests
- Manual cleanup management in every test file
- Scattered assertion patterns and test data creation

**Solution:**
- Create shared test utilities with centralized base classes
- Consolidate common test patterns and assertions
- Implement cleanup management system
- Standardize test data factories

**Files Modified:**
- Enhanced `tests/shared/test-utils.ts`
- Created `tests/shared/base-integration-test.ts`
- Created `tests/shared/cleanup-manager.ts`
- Created `tests/shared/assertions.ts`
- Updated all integration test files to use new patterns

**Test Coverage Assessment:**
**✅ Well Tested:**
- API error classes and inheritance
- Basic CRUD operations for Projects/Tasks
- API client construction and validation
- Integration test server setup/teardown

**❌ Missing Critical Coverage:**
- Core Services: `github.ts`, `scanner.ts`, `projects.ts`, `tasks.ts`, `users.ts`, `tags.ts`
- Server Routes: `project.ts`, `auth.ts`, `keys.ts`, `user.ts`, most of `v0.ts`
- Authentication & Authorization flows
- Database repository pattern classes
- Complex business logic edge cases

**Next Steps for Test Coverage:**
1. **Core Services Testing** - Unit tests for business logic with mocked dependencies
2. **Server Route Testing** - Integration tests for all API endpoints
3. **Database & Repository Testing** - Test repository classes with real database

### 7. Task Status Management Utilities ✅ **COMPLETED**
**Target Reduction: ~50 lines**

**Current Issue:**
- Task status logic duplicated between `TaskCard.tsx` and `TaskEditor.tsx`

**Solution:**
- Create shared task state management utilities
- Extract progress handling logic

**Files Modified:**
- Created `packages/app/src/utils/task-status.ts` (165 lines of utilities)
- Refactored `packages/app/src/components/solid/TaskCard.tsx` (saved ~59 lines)
- Refactored `packages/app/src/components/solid/TaskEditor.tsx` (saved ~19 lines)

**Results:**
- **Actual reduction**: ~78 lines of duplicated code eliminated
- **All tests passing**: 46/46 integration tests ✅
- **Enhanced maintainability** with centralized task status logic

## Phase 4: API Interface Standardization (Priority 1)

### 8. Clean & Consistent API Client Interface
**Target**: Standardize API client interface for optimal developer experience

**Current Issues:**
- **Inconsistent Naming**: Multiple methods doing the same thing (`list()`, `getAllProjects()`, `upsert()`, `create()`, `update()`)
- **Confusing Parameters**: Inconsistent parameter patterns between resources
- **Missing Domain Actions**: No dedicated endpoints for common business operations
- **Poor Resource Organization**: Flat structure instead of nested resources

**Proposed Clean Interface:**
```typescript
// Consistent CRUD operations
client.projects.list(filters?: {private?: boolean})
client.projects.get(id: string)
client.projects.create(data: CreateProject)
client.projects.update(id: string, changes: Partial<Project>)
client.projects.delete(id: string)

// Nested resource management
client.projects.config.get(project_id: string)
client.projects.config.save(project_id: string, config: ProjectConfig)
client.projects.specification.get(project_id: string)
client.projects.specification.update(project_id: string, spec: string)

// Domain-specific actions
client.projects.archive(id: string)
client.projects.publish(id: string)

// Auth with nested resources
client.auth.keys.create()
client.auth.keys.delete(key_id: string)
client.auth.session.get()

// Tasks with consistent patterns
client.tasks.list(filters?: {project_id?: string, tag_id?: string})
client.tasks.get(id: string)
client.tasks.create(data: CreateTask)
client.tasks.update(id: string, changes: Partial<Task>)
client.tasks.delete(id: string)

// Task domain actions
client.tasks.complete(id: string)
client.tasks.start(id: string)
client.tasks.tags.assign(task_id: string, tag_ids: string[])

// Dedicated tags management
client.tags.list()
client.tags.create(data: CreateTag)
client.tags.update(id: string, changes: Partial<Tag>)
client.tags.delete(id: string)
```

**Implementation Strategy:**
1. **Phase 4a**: Create new nested resource classes with clean interfaces
2. **Phase 4b**: Implement backward compatibility layer
3. **Phase 4c**: Update all internal usage to new interface
4. **Phase 4d**: Remove deprecated methods and update documentation

**Files to Modify:**
- Create `packages/api/src/resources/` directory structure
- Create nested resource classes: `ProjectConfigClient`, `ProjectSpecificationClient`, `AuthKeysClient`
- Update main client classes to use nested resources
- Create type definitions for new interfaces
- Update all usage throughout codebase
- Update tests to use new interface

**Benefits:**
- **Intuitive**: Follows REST and domain-driven design principles
- **Consistent**: Same patterns across all resources
- **Type-Safe**: Better TypeScript support with clear parameter types
- **Discoverable**: IDE autocomplete guides developers to correct methods
- **Maintainable**: Clear separation of concerns with nested resources

**Success Metrics:**
- All API calls follow consistent `resource.action()` or `resource.subresource.action()` pattern
- Zero methods with ambiguous names (no more `upsert` vs `create` confusion)
- All delete operations use simple `id: string` parameter
- 100% test coverage maintained throughout refactoring

## Implementation Strategy

### Step-by-Step Approach:
1. **Create Base Classes**: Start with base infrastructure (BaseClient, BaseRepository)
2. **Migrate Incrementally**: Update one service/client at a time to ensure stability
3. **Test Thoroughly**: Run tests after each major change
4. **Refactor Components**: Update UI components after backend consolidation
5. **Final Polish**: Complete cleanup and optimization tasks

### Testing Strategy:
- Run existing test suites after each phase
- Ensure no functionality regression
- Validate that build and type checking still work
- Test API endpoints manually where needed

### Risk Mitigation:
- Make changes incrementally to avoid breaking everything at once
- Keep git commits small and focused for easy rollback
- Test thoroughly between phases
- Maintain backward compatibility where possible

## Expected Benefits

### Code Maintainability:
- Reduced duplication means fewer places to update when making changes
- Consistent patterns across the codebase
- Easier onboarding for new developers

### Performance:
- Smaller bundle sizes due to reduced code duplication
- More efficient build times
- Better tree-shaking opportunities

### Developer Experience:
- Less boilerplate code to write
- More reusable components and utilities
- Consistent error handling and patterns

## Success Metrics
- **Lines of Code**: Target reduction of 670+ lines
- **Duplication Index**: Reduce code duplication by measuring repeated patterns
- **Test Coverage**: Maintain or improve current test coverage
- **Build Performance**: Measure build time improvements
- **Type Safety**: Ensure all refactored code maintains strong typing