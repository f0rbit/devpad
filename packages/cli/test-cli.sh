#!/bin/bash

# Test CLI commands
echo "Testing devpad CLI..."

# Set up test environment
export DEVPAD_API_KEY="test-key"
export DEVPAD_BASE_URL="http://localhost:3000/api/v1"

# Test help command
echo "1. Testing help command..."
bun run dist/index.js --help

# Test projects list
echo -e "\n2. Testing projects list..."
bun run dist/index.js projects list

# Test tasks list
echo -e "\n3. Testing tasks list..."
bun run dist/index.js tasks list

echo -e "\nCLI test complete!"