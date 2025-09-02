# DevPad Deployment

This directory contains deployment configurations for DevPad's refactored architecture with shared server logic.

## Architecture Overview

**Shared Server Logic**: `packages/server/src/server.ts`
- `migrateDb()`: Database migrations
- `createApp()`: Hono app configuration  
- `startServer()`: Full server startup
- `createServerExport()`: Export for serverless

**Deployment Scripts**: `deployment/`
- `production.ts`: Full-stack VPS deployment
- `serverless.ts`: API-only for serverless platforms
- `migrate.ts`: Standalone migration runner

**Local Development**: `packages/server/src/local.ts`
- API-only server for development
- Works with Astro dev server

## Deployment Options

### 1. VPS/Docker Deployment

Full-stack server with API + static files + migrations:

```bash
# Using Docker
docker build -f deployment/Dockerfile -t devpad .
docker run -p 3000:3000 -v devpad_data:/app/data devpad

# Using Docker Compose  
cd deployment && docker-compose up --build

# Direct execution
bun run deploy:production
```

**Features:**
- Serves Astro static files at `/`
- API routes at `/api/*`
- Auto-runs database migrations on startup
- Health checks at `/health`

### 2. Serverless Deployment

API-only server for serverless platforms:

```bash
# Start serverless API
bun run deploy:serverless

# Or import in serverless config
import server from './deployment/serverless.ts'
export default server
```

**Separate static deployment:**
```bash
cd packages/app
bun run build
# Deploy dist/ to CDN (Vercel, Netlify, etc.)
```

### 3. Local Development

Separate API and frontend servers:

```bash
# Terminal 1: API server
bun run dev:server  # or cd packages/server && bun start

# Terminal 2: Astro dev server  
bun run dev         # or cd packages/app && bun dev

# Both together
bun run dev:all
```

## Database Migrations

### Automatic (Production)
Migrations run on server startup in production mode.

### Manual
```bash
# Standalone migration
bun run deploy:migrate

# Or from app package
cd packages/app && bun run migrate
```

## Environment Variables

```env
# Required
DATABASE_FILE=/app/data/devpad.db

# Optional
PORT=3000
NODE_ENV=production
CORS_ORIGINS=https://devpad.tools,https://api.devpad.tools
STATIC_FILES_PATH=./packages/app/dist/client
```

## Server Configurations

### Production (`deployment/production.ts`)
```typescript
{
  runMigrations: true,    // Auto-migrate on startup
  enableStatic: true,     // Serve static files
  staticPath: "./packages/app/dist/client",
  corsOrigins: ["https://devpad.tools"],
  environment: "production"
}
```

### Serverless (`deployment/serverless.ts`)
```typescript
{
  runMigrations: false,   // Handle separately
  enableStatic: false,    // CDN serves static files
  corsOrigins: ["https://app.devpad.tools"],
  environment: "serverless"  
}
```

### Local (`packages/server/src/local.ts`)
```typescript
{
  runMigrations: false,   // Manual migrations
  enableStatic: false,    // Astro dev server handles this
  corsOrigins: ["http://localhost:4321"],
  port: 3001,             // Avoid conflicts
  environment: "development"
}
```

## File Structure

```
deployment/
├── production.ts    # Full-stack VPS deployment
├── serverless.ts    # API-only serverless deployment  
├── migrate.ts       # Standalone migration runner
├── Dockerfile       # Docker build configuration
└── README.md        # This file

packages/server/src/
├── server.ts        # Shared server logic and functions
├── local.ts         # Local development configuration
├── index.ts         # Backward compatibility exports
└── ...             # Routes, middleware, etc.
```

## Quick Commands

```bash
# Development
bun run dev:all           # Start both API and frontend
bun run dev:server        # API server only

# Deployment  
bun run deploy:production # Full-stack production
bun run deploy:serverless # API-only serverless
bun run deploy:migrate    # Run migrations only

# Docker
cd deployment && docker-compose up --build # Local Docker environment
```