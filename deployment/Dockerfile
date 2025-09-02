# First stage: Build todo-tracker application from go source code
FROM golang:1.22.1 as go-builder

WORKDIR /todo-tracker
RUN apt-get update && apt-get install -y git
RUN git clone https://github.com/f0rbit/todo-tracker.git .
RUN go build -o todo-tracker

# Second stage: Build the application
FROM oven/bun:1.1.37 as builder

# Install system dependencies
RUN apt-get update && apt-get install -y unzip

# Set up workspace
WORKDIR /app

# Copy workspace configuration and source code
COPY package.json bun.lockb ./
COPY packages/ packages/
COPY todo-config.json .
COPY --from=go-builder /todo-tracker/todo-tracker .

# Install all workspace dependencies
RUN bun install --frozen-lockfile

# Build the Astro app (creates dist folder with static assets and SSR handler)
WORKDIR /app/packages/app
RUN bun run build

# Build the Hono server for production
WORKDIR /app/packages/server
RUN bun run build:production

# Third stage: Production runtime
FROM oven/bun:1.1.37-slim as runtime

# Install system dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy todo-tracker binary
COPY --from=go-builder /todo-tracker/todo-tracker .
COPY todo-config.json .

# Copy built applications and dependencies
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_FILE=/app/data/devpad.db
ENV STATIC_FILES_PATH=./packages/app/dist/client

# Create data directory for SQLite
RUN mkdir -p /app/data

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Start the production server
WORKDIR /app
CMD ["bun", "deployment/production.ts"]