#!/bin/bash

# E2E Test Runner Script
# Usage: ./scripts/e2e-test.sh [environment] [options]
#   environment: local, docker, staging (default: local)
#   options: Any additional playwright options (e.g., --ui, --headed)

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Default environment
ENV=${1:-local}
shift || true  # Remove first argument if it exists

echo -e "${GREEN}🧪 Running E2E tests in ${YELLOW}$ENV${GREEN} environment${NC}"
echo ""

case $ENV in
  local)
    echo "📦 Building packages..."
    bun run build
    
    echo "🚀 Starting local server..."
    TEST_ENV=local bunx playwright test "$@"
    ;;
    
  docker)
    echo "🐳 Building Docker image..."
    bun run docker:build
    
    echo "🚀 Starting Docker services..."
    bun run docker:up
    
    # Wait for services to be ready
    echo "⏳ Waiting for services to be ready..."
    sleep 10
    
    # Check if service is responding
    if curl -f http://localhost:3000 > /dev/null 2>&1; then
      echo -e "${GREEN}✅ Docker services are ready${NC}"
    else
      echo -e "${RED}❌ Docker services failed to start${NC}"
      docker-compose -f deployment/docker-compose.local.yml logs
      bun run docker:down
      exit 1
    fi
    
    # Run tests
    echo "🧪 Running tests..."
    TEST_ENV=docker bunx playwright test "$@"
    TEST_EXIT_CODE=$?
    
    # Clean up
    echo "🧹 Cleaning up Docker services..."
    bun run docker:down
    
    exit $TEST_EXIT_CODE
    ;;
    
  staging)
    echo "🌐 Testing against staging environment..."
    echo "   URL: ${STAGING_URL:-https://staging.devpad.tools}"
    
    # Check if staging is accessible
    if curl -f "${STAGING_URL:-https://staging.devpad.tools}/health" > /dev/null 2>&1; then
      echo -e "${GREEN}✅ Staging environment is accessible${NC}"
    else
      echo -e "${RED}❌ Staging environment is not accessible${NC}"
      exit 1
    fi
    
    TEST_ENV=staging bunx playwright test "$@"
    ;;
    
  *)
    echo -e "${RED}❌ Invalid environment: $ENV${NC}"
    echo "Usage: $0 [local|docker|staging] [playwright options]"
    echo ""
    echo "Examples:"
    echo "  $0                    # Run tests locally"
    echo "  $0 local --ui         # Run tests locally with UI"
    echo "  $0 docker             # Run tests in Docker"
    echo "  $0 staging --headed   # Run tests against staging with browser visible"
    exit 1
    ;;
esac

echo ""
echo -e "${GREEN}✅ E2E tests completed${NC}"
