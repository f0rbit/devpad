# Development Guidelines for devpad Codebase

THIS PROJECT IS CALLED "devpad" NOT "DevPad". PLEASE UTILISE CORRECT CAPITLISATION: "devpad"

NEVER EVER MAKE ANY COMMITS OR EVERY DO A GIT PUSH/PULL OR MERGE/REBASE!!!!

Please don't be super agreeable with whatever I say - if you think there's an issue with my suggestions, push back & suggest better alternatives. I may be wrong upon occasion challenge me. But then once we've come to a decision - let's disagree & commit and move forward.

## Build & Test Commands
- Dev server: `bun dev` (root) or `cd apps/main && bun dev`
- Build all: `bun build` (builds all packages)
- Formatting guidelines are defined in `biome.json` - DO NOT RUN `bun lint:fix` - this will break astro imports
- Type check: `cd apps/main && bun check`
- Unit tests: `make unit` or `bun test unit`
- Integration tests: `make integration` (sequential) or `bun test integration/`
- Single test: `bun test path/to/test.test.ts`
- Coverage: `make coverage` then `make coverage-stats`
- Database migrate: `cd apps/main && bun migrate`

## Code Style & Architecture
- Naming: snake_case (variables), camelCase (functions), PascalCase (classes/types)
- Use one-word names when possible: `getProjects()` → `projects.get()`
- Prefer nested objects over complex function names in interfaces
- Pure functions & composition over classes/inheritance
- Avoid if/else - use early returns instead
- Avoid try/catch - use errors as values with union types
- Max 5 layers indentation - refactor deeper nesting into smaller functions
- Builder pattern over large constructors (with sane defaults)
- Import using aliases when beneficial
- No comments except for complex business logic

## Suggested Development Workflow
1. **Define**: Generate types/schema/interfaces, ask for confirmation
2. **Test**: Create integration tests for actual use cases (not unit tests)
3. **Plan**: Layout implementation strategy based on interfaces & tests
4. **Implement**: Execute plan, validate against tests for completion

## Framework Guidelines
- Frontend: Astro + SolidJS (functional components)
- Backend: Bun + TypeScript (strict mode)
- Database: SQLite + Drizzle ORM
- Testing: Integration tests log to `packages/server/server.log` (use `DEBUG_LOGGING="true"` for stdout)

## Repository Structure & Key Files
```
devpad/
├── apps/
│   ├── main/src/                       # devpad Astro frontend
│   │   ├── components/solid/          # SolidJS components
│   │   ├── pages/                     # Astro pages
│   │   ├── layouts/                   # Page layouts
│   │   └── utils/api-client.ts        # Frontend API client instance
│   ├── blog/                          # Blog Astro frontend
│   └── media/                         # Media timeline Astro frontend
├── packages/
│   ├── api/src/
│   │   ├── api-client.ts              # Main API client with Result-wrapped operations
│   │   ├── request.ts                 # HTTP client implementation
│   │   └── result.ts                  # Result wrapper for error handling
│   ├── core/src/
│   │   ├── services/
│   │   │   ├── projects.ts            # Project management logic
│   │   │   ├── tasks.ts               # Task operations
│   │   │   ├── scanning.ts            # Code scanning functionality
│   │   │   ├── milestones.ts          # Milestone management
│   │   │   └── goals.ts               # Goal tracking
│   │   └── auth/
│   │       ├── lucia.ts               # Lucia auth setup
│   │       └── oauth.ts               # OAuth providers
│   ├── schema/src/
│   │   ├── types.ts                   # All TypeScript types and database models
│   │   ├── validation.ts              # Zod schemas for runtime validation
│   │   └── database/
│   │       ├── schema.ts              # Drizzle database schema
│   │       └── migrate.ts             # Database migrations
│   └── server/src/
│       ├── routes/
│       │   ├── v0.ts                  # Main API routes
│       │   └── auth.ts                # Authentication routes
│       └── middleware/auth.ts         # Auth middleware
├── tests/
│   ├── integration/                   # Integration test suites
│   └── shared/test-utils.ts          # Test utilities and helpers
├── biome.json                         # Code formatting config
├── Makefile                           # Build and test commands
└── package.json                       # Root workspace config
```


# Debugging
When running integration tests, logs will get piped to `packages/server/server.log`, only read the logs if you're looking for errors.

In the case where you want logs in stdout, specify the exact test suite you want to run in the command using bun specifically rather than `make integration` & pass `DEBUG_LOGGING="true"` as an env variable to the function.
