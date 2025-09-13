# First stage: Build todo-tracker application from go source code
FROM golang:1.22.1 AS go-builder

WORKDIR /todo-tracker
RUN apt-get update && apt-get install -y git
RUN git clone https://github.com/f0rbit/todo-tracker.git .
RUN go build -o todo-tracker

# Second stage: Build the application
FROM oven/bun:1.1.37 AS builder

# Install system dependencies
RUN apt-get update && apt-get install -y unzip

# Set up workspace
WORKDIR /app

# Copy workspace configuration and source code
COPY package.json bun.lockb ./
COPY packages/ packages/
COPY deployment/ deployment/
COPY todo-config.json .
COPY --from=go-builder /todo-tracker/todo-tracker .

# Build the Astro app (creates dist folder with static assets and SSR handler)

# Install all workspace dependencies
RUN bun install --frozen-lockfile

# Build all packages in correct order
# First build schema package
WORKDIR /app/packages/schema
RUN bun run build

# Build other packages that depend on schema
WORKDIR /app/packages/api
RUN bun run build

WORKDIR /app/packages/core
RUN bun run build


WORKDIR /app/packages/app
RUN bun run build

# Build the Hono server for production
WORKDIR /app/packages/server
RUN bun run build

# Production runtime stage
FROM oven/bun:1.1.37-slim AS runtime

# Install system dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy todo-tracker binary
COPY --from=go-builder /todo-tracker/todo-tracker .
COPY todo-config.json .

# Copy built applications and dependencies
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/deployment ./deployment

# Set default environment variables (can be overridden at runtime)
ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_FILE=/app/data/devpad.db
ENV STATIC_FILES_PATH=./packages/app/dist/client

# Create data directory for SQLite
RUN mkdir -p /app/data

# Expose port (this is just documentation, actual port is set at runtime)
EXPOSE 3000

# Health check using curl with PORT variable
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:${PORT:-3000}/health || exit 1

# Start the production server
WORKDIR /app
CMD ["bun", "deployment/production.ts"]
