#!/bin/bash
set -e

echo "Checking lint manifest drift..."
bunx f0rbit-lint check

echo "Building packages..."
cd packages/schema && bun run build && cd ../..
cd packages/api && bun run build && cd ../..
cd packages/cli && bun run build && cd ../..
cd packages/mcp && bun run build && cd ../..

echo "Running unit tests..."
DATABASE_FILE=./test.db NODE_ENV=test bun run test:unit

echo "Running integration tests..."
DATABASE_FILE=./test.db NODE_ENV=test bun run test:integration

echo "Running lint..."
bun run lint
bun run lint:sh
bun run fmt:check

echo "Gate passed."
