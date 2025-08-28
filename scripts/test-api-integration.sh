#!/bin/bash

# Test API Integration - Creates test user and runs integration tests

set -e

echo "🚀 Starting API Integration Tests"
echo "================================="

# Check if the Astro dev server is running
if ! curl -s http://localhost:4321/api/v0 >/dev/null; then
    echo "❌ Astro dev server not running at http://localhost:4321"
    echo "Please run 'cd app && bun dev' in another terminal"
    exit 1
fi

echo "✅ Astro dev server is running"

# Change to app directory
cd app

# Create test user and get API key
echo "📝 Creating test user and API key..."
API_KEY=$(bun run scripts/create-test-user.ts 2>/dev/null)

if [ -z "$API_KEY" ]; then
    echo "❌ Failed to create test user or get API key"
    exit 1
fi

echo "✅ Test user created with API key: ${API_KEY:0:8}..."

# Export the API key for tests
export DEVPAD_TEST_API_KEY="$API_KEY"
export DEVPAD_TEST_BASE_URL="http://localhost:4321/api/v0"

# Change to API directory and run integration tests
cd ../api

echo "🧪 Running integration tests..."
echo ""

bun test tests/integration/ --verbose

echo ""
echo "✅ Integration tests completed!"
echo "🧹 Note: Test data may remain in database for inspection"