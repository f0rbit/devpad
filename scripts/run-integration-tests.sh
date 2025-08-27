#!/bin/bash
set -e

# Ensure we're in the right directory
cd "$(dirname "$0")/.."

# Kill any process using port 8080
echo "Killing any process using port 8080..."
lsof -ti:8080 | xargs kill -9 || true
sleep 2  # Give time for port to be released

# Set test environment variables
export NODE_ENV=test
export PORT=8080
export DATABASE_URL=sqlite://$(pwd)/test.db
export DATABASE_FILE=$(pwd)/test.db

# Remove existing test database if it exists
rm -f test.db

# First run debug migrations to create the database schema
echo "Running database migrations..."
cd app/api
bun run ../../app/scripts/debug-migrations.ts || {
    echo "Migration failed. Check the error above."
    exit 1
}

# Start the devpad server in the background
echo "Starting devpad server..."
bun start-server.ts > server.log 2>&1 &
SERVER_PID=$!

# Wait and check if server started successfully
MAX_WAIT=30
WAIT_COUNT=0
SERVER_STARTED=false

while [ $WAIT_COUNT -lt $MAX_WAIT ]; do
    # Check if process is still running
    if ! kill -0 $SERVER_PID 2>/dev/null; then
        echo "Error: Devpad server process died unexpectedly. Check server.log for details:"
        cat server.log
        exit 1
    fi

    # Try to connect to the server
    if curl -s -m 5 http://localhost:8080 > /dev/null; then
        SERVER_STARTED=true
        break
    fi

    sleep 1
    ((WAIT_COUNT++))
done

# Check if server started
if [ "$SERVER_STARTED" = false ]; then
    echo "Error: Devpad server did not start within $MAX_WAIT seconds"
    cat server.log
    kill $SERVER_PID || true
    exit 1
fi

# Set up test environment for integration tests
echo "Setting up test environment..."
export DEVPAD_TEST_API_KEY="test-integration-key-12345678"  # Dummy key since server doesn't validate
export DEVPAD_TEST_BASE_URL=http://localhost:8080/api/v0
export DEVPAD_TEST_TYPE=integration

# Run integration tests
echo "Running integration tests..."
# We're already in app/api from the migration step
bun test:integration

# Store test exit code
TEST_EXIT_CODE=$?

# Clean up server
kill $SERVER_PID || true

# Remove test database
rm -f ../../test.db

# Exit with the test's exit code
exit $TEST_EXIT_CODE