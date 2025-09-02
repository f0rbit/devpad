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

### 6. Test Utility Consolidation
**Target Reduction: ~25 lines**

**Current Issue:**
- Similar setup patterns between integration and unit tests
- Repeated database setup, user creation patterns

**Solution:**
- Create shared test utilities
- Consolidate common test patterns

**Files to Modify:**
- `tests/integration/setup.ts`
- `packages/api/tests/unit/setup.ts`
- Create `tests/shared/test-utils.ts` (new)

### 7. Task Status Management Utilities
**Target Reduction: ~50 lines**

**Current Issue:**
- Task status logic duplicated between `TaskCard.tsx` and `TaskEditor.tsx`

**Solution:**
- Create shared task state management utilities
- Extract progress handling logic

**Files to Modify:**
- Create `packages/app/src/utils/task-status.ts` (new)
- `packages/app/src/components/solid/TaskCard.tsx`
- `packages/app/src/components/solid/TaskEditor.tsx`

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