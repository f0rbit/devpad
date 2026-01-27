#!/bin/bash

# E2E Test Environment Checker
# Checks if the e2e test environment is properly set up

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔍 E2E Test Environment Check${NC}"
echo "================================"
echo ""

# Check Node/Bun
echo -n "Checking Bun installation... "
if command -v bun &> /dev/null; then
  echo -e "${GREEN}✓${NC} ($(bun --version))"
else
  echo -e "${RED}✗ Bun not installed${NC}"
  exit 1
fi

# Check Playwright
echo -n "Checking Playwright installation... "
if [ -f "node_modules/@playwright/test/package.json" ]; then
  PLAYWRIGHT_VERSION=$(cat node_modules/@playwright/test/package.json | grep '"version"' | cut -d'"' -f4)
  echo -e "${GREEN}✓${NC} (v$PLAYWRIGHT_VERSION)"
else
  echo -e "${YELLOW}⚠ Playwright not installed. Run: bun install${NC}"
fi

# Check Playwright browsers
echo -n "Checking Playwright browsers... "
if bunx playwright install --dry-run 2>&1 | grep -q "All browsers are already installed"; then
  echo -e "${GREEN}✓${NC}"
else
  echo -e "${YELLOW}⚠ Browsers not installed. Run: bunx playwright install${NC}"
fi

# Check Docker
echo -n "Checking Docker installation... "
if command -v docker &> /dev/null; then
  echo -e "${GREEN}✓${NC} ($(docker --version | cut -d' ' -f3 | sed 's/,//'))"
else
  echo -e "${YELLOW}⚠ Docker not installed (optional, needed for docker tests)${NC}"
fi

# Check Docker Compose
echo -n "Checking Docker Compose... "
if command -v docker-compose &> /dev/null; then
  echo -e "${GREEN}✓${NC} ($(docker-compose --version | cut -d' ' -f4 | sed 's/,//'))"
else
  echo -e "${YELLOW}⚠ Docker Compose not installed (optional, needed for docker tests)${NC}"
fi

# Check build status
echo -n "Checking if packages are built... "
if [ -d "apps/main/dist" ] && [ -d "packages/server/dist" ]; then
  echo -e "${GREEN}✓${NC}"
else
  echo -e "${YELLOW}⚠ Packages not built. Run: bun run build${NC}"
fi

# Check test database
echo -n "Checking test database setup... "
if [ -d "database" ]; then
  echo -e "${GREEN}✓${NC}"
else
  mkdir -p database
  echo -e "${GREEN}✓${NC} (created)"
fi

# Check E2E test files
echo -n "Checking E2E test files... "
if [ -f "tests/e2e/pages.spec.ts" ]; then
  TEST_COUNT=$(ls -1 tests/e2e/*.spec.ts 2>/dev/null | wc -l)
  echo -e "${GREEN}✓${NC} ($TEST_COUNT test file(s) found)"
else
  echo -e "${RED}✗ No E2E test files found${NC}"
fi

echo ""
echo -e "${BLUE}Environment Configurations:${NC}"
echo "------------------------"
echo -e "Local:   ${GREEN}http://localhost:3001${NC}"
echo -e "Docker:  ${GREEN}http://localhost:3000${NC}"
echo -e "Staging: ${GREEN}https://staging.devpad.tools${NC}"

echo ""
echo -e "${BLUE}Available Commands:${NC}"
echo "------------------------"
echo "bun run e2e:local      - Run tests against local server"
echo "bun run e2e:docker     - Run tests in Docker environment"
echo "bun run e2e:staging    - Run tests against staging"
echo "bun run e2e:local:ui   - Run tests with Playwright UI"
echo "./scripts/e2e-test.sh  - Helper script with more options"

echo ""
echo -e "${GREEN}✅ Environment check complete${NC}"
