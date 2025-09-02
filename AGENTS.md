# Development Guidelines for devpad Codebase

## Project Structure
- Frontend: Astro with SolidJS
- Backend: TypeScript/Bun
- Database: SQLite with Drizzle ORM

## Build & Test Commands
- Start dev server: `cd app && bun dev`
- Build project: `cd app && bun build`
- Run tests: `cd app && bun test`
- Run specific test: `cd app && bun test path/to/specific/test.test.ts`
- Type check: `cd app && bun check`
- Database migrate: `cd app && bun migrate`
- Docker build: `make build`
- Docker run: `make run`

## Code Style Guidelines
- Language: TypeScript (Strict mode)
- Framework: Astro with SolidJS
- Imports: 
  - Prefer absolute imports from project root
  - Group imports: external libs, internal modules, local components
- Formatting:
  - Use Prettier with max line width 180
  - Use tabs for indentation
  - Semicolons required
- Naming Conventions:
  - camelCase for variables and functions
  - PascalCase for classes, components, types
  - UPPER_SNAKE_CASE for constants
- Error Handling:
  - Use Zod for runtime validation
  - Prefer typed errors
  - Log errors with context
- Type Safety:
  - Use strict TypeScript settings
  - Prefer interfaces over type aliases
  - Minimize use of `any`

## Best Practices
- Prefer functional components
- Use solid-js primitives for state management
- Keep components small and focused
- Add JSDoc comments for complex logic
- Handle async operations with proper error catching
- Maintain API type consistency
- Ensure visibility and access control for projects/tasks


# Debugging
When running integration tests, logs will get piped to `packages/server/server.log`, only read the logs if you're looking for errors.

In the case where you want logs in stdout, specify the exact test suite you want to run in the command using bun specifically rather than `make integration` & pass `DEBUG_LOGGING="true"` as an env variable to the function.