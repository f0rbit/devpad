#!/bin/bash
set -e

# Ensure we're in the right directory
cd "$(dirname "$0")/.."

# Kill any process using port 4321 (Astro default)
echo "Killing any process using port 4321..."
lsof -ti:4321 | xargs kill -9 || true
sleep 2  # Give time for port to be released

# Set test environment variables
export NODE_ENV=test
export DATABASE_URL=sqlite://$(pwd)/test.db
export DATABASE_FILE=$(pwd)/test.db

# Remove existing test database if it exists
rm -f test.db

# First run debug migrations to create the database schema
echo "Running database migrations..."
cd app
bun run scripts/debug-migrations.ts || {
    echo "Migration failed. Check the error above."
    exit 1
}
cd ..

# Start the Astro dev server in the background
echo "Starting Astro dev server..."
cd app
bun dev > astro-server.log 2>&1 &
SERVER_PID=$!

# Wait and check if server started successfully
MAX_WAIT=30
WAIT_COUNT=0
SERVER_STARTED=false

while [ $WAIT_COUNT -lt $MAX_WAIT ]; do
    # Check if process is still running
    if ! kill -0 $SERVER_PID 2>/dev/null; then
        echo "Error: Astro server process died unexpectedly. Check astro-server.log for details:"
        cat astro-server.log
        exit 1
    fi

    # Try to connect to the server
    if curl -s -m 5 http://localhost:4321/api/v0 > /dev/null; then
        SERVER_STARTED=true
        break
    fi

    sleep 2
    ((WAIT_COUNT++))
done

# Check if server started
if [ "$SERVER_STARTED" = false ]; then
    echo "Error: Astro server did not start within $MAX_WAIT seconds"
    cat astro-server.log
    kill $SERVER_PID || true
    exit 1
fi

# Create test user and API key
echo "Creating test user and API key..."
export DEVPAD_TEST_API_KEY=$(bun run app/scripts/create-test-user.ts)
export DEVPAD_TEST_BASE_URL=http://localhost:4321/api/v0

echo "Using API key: $DEVPAD_TEST_API_KEY"

if [ -z "$DEVPAD_TEST_API_KEY" ]; then
    echo "Error: Failed to generate API key"
    kill $SERVER_PID || true
    exit 1
fi

# Run integration tests
echo "Running integration tests..."
cd api
bun test:integration

# Store test exit code
TEST_EXIT_CODE=$?

# Clean up server
kill $SERVER_PID || true

# Remove test database
cd ..
rm -f ../test.db

# Exit with the test's exit code
exit $TEST_EXIT_CODE