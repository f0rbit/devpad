# devpad

A collection of tools for the development lifecycle. [devpad.tools](https://devpad.tools)

## What is devpad?

devpad is a self-hosted platform for managing the development lifecycle. It combines project management, task tracking (with automatic scanning of TODO/FIXME comments from your codebase), milestones, goals, a blog integration, and a media timeline. The frontend is built with Astro + SolidJS, the API runs on Hono (Cloudflare Workers compatible), and data lives in SQLite (D1 in production) via Drizzle ORM.

## Repository structure

```
apps/
  main/          # Main app (devpad.tools) -- Astro + SolidJS
  blog/          # Blog app (blog.devpad.tools) -- Astro + SolidJS
  media/         # Media timeline (media.devpad.tools) -- Astro + SolidJS
packages/
  api/           # TypeScript API client (@devpad/api)
  cli/           # CLI tool (@devpad/cli)
  mcp/           # MCP server for AI assistants (@devpad/mcp)
  core/          # Shared services, UI components, auth
  schema/        # Database schema, types, validation
  worker/        # Hono API server (Cloudflare Workers)
tests/
  integration/   # Integration test suites (238 tests)
  e2e/           # Playwright E2E tests
```

## Quick start

```bash
bun install
bun dev          # Main app on :3000
bun dev:all      # All services (main :3000, worker :3001, blog :3002, media :3003)
```

## Tech stack

- **Frontend**: Astro + SolidJS
- **API**: Hono (Cloudflare Workers compatible)
- **Database**: SQLite + Drizzle ORM (D1 in production)
- **Testing**: Bun test (62 unit + 238 integration)
- **Runtime**: Bun

## Published packages

| Package | Description |
|---------|-------------|
| [`@devpad/api`](packages/api) | TypeScript API client |
| [`@devpad/cli`](packages/cli) | Command-line interface |
| [`@devpad/mcp`](packages/mcp) | MCP server for AI tools |

## License

MIT
