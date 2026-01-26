# Devpad Project History - Comprehensive Timeline

## Executive Summary

Devpad is a personal project management and todo tracking application that evolved from a simple todo app into a full-featured development workflow tool. The project spans **3+ years** (October 2022 - January 2026) with multiple major rewrites and architectural changes.

---

## Timeline of Major Milestones

### 1. Initial Creation & T3 Stack Foundation
**Date:** October 19, 2022  
**Commits:** `577d3ee` → `d72db1b`

The project began as a simple Next.js application, quickly recreated using the T3 stack (Next.js, tRPC, Prisma, NextAuth). The initial focus was on building a subdomain-based multi-app architecture.

**Key commits:**
- `577d3ee` - Initial commit
- `d72db1b` - recreate using create-t3-app
- `c9ba848` - add subdomain apps

---

### 2. Todo App MVP
**Date:** October 22-29, 2022  
**Commits:** `77db535` → `70f0295`

The first major feature: a complete todo tracking application with full CRUD operations, authentication, tags, filtering, and a modular editor system.

**Key features built:**
- Todo database initialization (`77db535` - init todo db)
- Dashboard UI with status icons
- Auth login modal & site-wide authentication
- Tag system with filtering
- Module-based task editing system
- Priority, start/end dates support

**Key commits:**
- `66bdb30` - create todo dashboard UI
- `d07c983` - add auth login modal
- `cfe793b` - add sorting/filtering
- `77c323c` - implement tag editor
- `c848597` - begin the major refactor (module system)

---

### 3. Project Manager Addition
**Date:** February 2-6, 2023  
**Commits:** `4870438` → `22:42:58`

Built the project management system on top of the existing todo infrastructure, including project creation, goals, milestones, and action history.

**Key features:**
- Projects database schema
- Project pages in Next.js 13 app directory
- Project creation/deletion screens
- Goals system with completion tracking
- Action history rendering
- Version management

**Key commits:**
- `4870438` - add projects in db
- `ac6496d` - add projects pages
- `10e6e2a` - create projects pages in app directory
- `0846fdc` - add create project goals UI
- `063c7b8` - add rendering for history actions

---

### 4. Domain & Deployment Migration
**Date:** January 31 - February 1, 2023  
**Commits:** Multiple deployment fixes

Migrated from local development to Railway hosting, dealing with domain routing and environment configuration.

**Key changes:**
- Changed from devpad.local to Vercel/Railway targets
- Implemented ROOT_DOMAIN environment variable
- Fixed subdomain routing issues
- Added site-wide titles & icons

---

### 5. Project Specification & University Integration
**Date:** February 19 - March 5, 2023  
**Commits:** Multiple feature additions

Extended the system to handle project specifications and added university assignment tracking.

**Key features:**
- Task editor integration in projects
- Project specification editing
- University classes UI
- Assignment tracking from database

**Key commits:**
- `21:17:56` - implement project specification & editor
- `19:08:50` - build UI for university classes
- `20:33:37` - use db assignments to render

---

### 6. API Development for External Integration
**Date:** February 8, 2023 onwards  
**Commits:** API route additions

Built REST API endpoints to enable external integrations, particularly for the personal website (forbit.dev).

**Key commits:**
- `src/app/api/project/route.ts` - Initial API route
- Multiple tRPC refactors for cleaner API structure
- API key system for external access (`20230619023857_add_api_keys` migration)

---

### 7. Blogging Phase Begins
**Date:** March 7, 2024  
**Blog Post:** "Rescoping devpad"

Started documenting the development journey on forbit.dev/blog with detailed posts about:
- Original motivations and design flaws
- The todo-tracker concept (scanning code for TODOs)
- Plans to learn new languages through reimplementation

**Blog posts published:**
1. "Rescoping devpad" (March 7, 2024)
2. "devpad #1 - Redesign" (March 21, 2024)
3. "devpad #2 - Redesign Motivations"
4. "devpad #3 - Tech Stack Issues"
5. "devpad #4 - MVP check-in"
6. "devpad #5 - Visual Update"
7. "devpad #6 - MVP Progress"

---

### 8. Fresh Start - Astro Rewrite
**Date:** March 24, 2024  
**Commits:** `608c4f1` → `ce6138b`

Complete project reset - deleted all existing code and started fresh with Astro framework.

**Key commits:**
- `608c4f1` - fresh start (deleted 11,411 lines from package-lock.json, all Prisma schemas, all Next.js code)
- `ce6138b` - add astro template (created front-end/ directory with Astro starter)

**Deleted:**
- All Next.js/tRPC code
- Prisma schema and migrations
- Docker compose setup
- Old icons and public assets

---

### 9. Astro MVP Development
**Date:** March 24 - April 8, 2024  
**Commits:** Post-fresh-start development

Rebuilt core functionality in Astro with SolidJS for interactivity.

**Key commits:**
- `750ca5e` - add drizzle test (Drizzle ORM adoption)
- `add temp page for goals` - Rebuilt goals system
- `add pages for editing project` - Project editing
- `add page layout to sub-pages` - UI structure

---

### 10. Monorepo Restructure
**Date:** August 30, 2025  
**Commits:** `cfee0cc` → `3a19e2f`

Major architectural change: restructured into a proper monorepo with separate packages.

**New structure:**
```
packages/
├── api/        # Type-safe API client
├── app/        # Astro frontend
├── schema/     # Shared types & validation
├── core/       # Business logic
├── server/     # Hono backend
├── mcp/        # Model Context Protocol server
└── cli/        # Command-line interface
```

**Key commits:**
- `cfee0cc` - restructure: initial
- `3a19e2f` - restructure: `@devpad`
- `169d584` - format: introduce `biome`

---

### 11. API Decoupling & Multi-Platform Support
**Date:** September 4-15, 2025  
**Commits:** Extensive refactoring
**Blog Post:** "devpad #7 - Decoupling API from AstroJS with Bun + Hono"

Decoupled the API from Astro, enabling:
- Independent API deployment
- Type-safe API client (`@devpad/api`)
- MCP server for AI integrations
- CLI tool for terminal usage
- E2E testing with Playwright

**Key features:**
- Hono-based server with Bun runtime
- JWT-based cross-domain authentication
- GitHub project scanning integration
- NPM package publishing workflow
- Docker compose deployment

**Key commits:**
- `f75149a` - decouple api from astro app, add mcp & cli applications (#34)
- `be31d84` - feat: `@devpad/server`
- `8e1a6db` - feat(mcp): initial commit
- `a12b60e` - feat(cli): initial implementation

**Version tags:**
- `v1.0.1` (September 10, 2025)
- `v1.1.0` → `v1.2.12` (September 10-15, 2025)

---

### 12. Goals & Milestones System
**Date:** September 6, 2025  
**Commits:** `cd9add9` → `704986f`

Rebuilt the goals and milestones system with proper API integration.

**Key commits:**
- `cd9add9` - feat(api): milestones & goals
- `85d7d99` - feat(goals): initialise client-side impl
- `704986f` - feat(app): style milestone manager

---

### 13. Project Scanning Feature
**Date:** September 14, 2025  
**Commits:** `67943c5` → `dd3709c`

Implemented the original vision: scanning codebases for TODO comments and linking them to tasks.

**Key commits:**
- `67943c5` - feat(api): implement project scanning
- `6b77026` - feat(server): implement scanning updates
- `ef78045` - feat(server): use scanning logic from old version
- `dd3709c` - fix(server): build `todo-tracker` at runtime

---

### 14. Cross-Domain Auth & Convergence
**Date:** December 26-31, 2025  
**Commits:** Latest development
**Blog Post:** "devpad #8 - Convergence"

Enhanced authentication to support multiple subdomains and prepare for merging related projects (blog, media-timeline) under the devpad umbrella.

**Key commits:**
- `7e0c2f1` - feat(auth): allow for subdomain to share auth
- `736de75` - feat(auth): implement JWT-based cross-domain authentication
- `b2c16c4` - feat(app): replace project list with card-based grid layout

**Vision:** Combine devpad, blog.forbit.dev, and media-timeline under one domain with shared authentication, using Cloudflare Workers for cloud-native deployment.

---

## Summary Statistics

| Metric | Value |
|--------|-------|
| Project Duration | ~3 years 3 months |
| Total Major Rewrites | 2 (Next.js → Astro, Monolithic → Monorepo) |
| Blog Posts Written | 8+ about devpad specifically |
| Version Tags | 28 |
| Tech Stacks Used | T3 (Next.js/tRPC/Prisma) → Astro/SolidJS/Drizzle → Bun/Hono |
| Current Packages | 7 (api, app, schema, core, server, mcp, cli) |

---

## Technology Evolution

```
2022: Next.js + tRPC + Prisma + NextAuth (T3 Stack)
  ↓
2024: Astro + SolidJS + Drizzle ORM
  ↓
2025: Bun + Hono + Astro + Drizzle (Monorepo)
       + MCP Server + CLI + Type-safe API Client
```

---

## Key Blog Posts (chronological)

1. **Rescoping devpad** (March 7, 2024) - Reflection on original goals and new direction
2. **devpad #1 - Redesign** (March 21, 2024) - Visual analysis and new mockups
3. **devpad #2 - Redesign Motivations** - Deep dive into design philosophy
4. **devpad #3 - Tech Stack Issues** - Session synchronization challenges
5. **devpad #4 - MVP check-in** - Progress update and roadmap
6. **devpad #5 - Visual Update** - Hyper-minimalist design exploration
7. **devpad #6 - MVP Progress** - Open source plans and release roadmap
8. **devpad #7 - Decoupling API** (September 15, 2025) - Bun + Hono integration guide
9. **devpad #8 - Convergence** (December 27, 2025) - Vision for unified ecosystem

---

*Generated: January 24, 2026*
