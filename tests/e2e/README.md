# E2E Tests

End-to-end tests for devpad using Playwright.

## Quick Start

```bash
# Check your environment is set up
./scripts/e2e-check.sh

# Install Playwright browsers (first time only)
bunx playwright install chromium

# Run tests in different environments
bun run e2e:local      # Test against local server
bun run e2e:docker     # Test in Docker environment  
bun run e2e:staging    # Test against staging environment
```

## Test Environments

### 1. Local Development (`TEST_ENV=local`)
- **URL**: http://localhost:3001
- **Setup**: Automatically starts server via `bun start` in packages/server
- **Database**: Uses test database at `database/test.db`
- **Use Case**: Quick testing during development

### 2. Docker Environment (`TEST_ENV=docker`)
- **URL**: http://localhost:3000
- **Setup**: Uses `docker-compose.local.yml`
- **Database**: SQLite in Docker container
- **Use Case**: Testing production-like environment locally

### 3. Staging Environment (`TEST_ENV=staging`)
- **URL**: https://staging.devpad.tools
- **Setup**: Tests against deployed staging server
- **Database**: Production staging database
- **Use Case**: Pre-production validation

## Running Tests

### Basic Commands

```bash
# Run all tests (defaults to local)
bun run e2e

# Run with UI mode for debugging
bun run e2e:local:ui

# Run specific test file
TEST_ENV=local bunx playwright test pages.spec.ts

# Run with visible browser
TEST_ENV=local bunx playwright test --headed

# Generate test report
bunx playwright show-report .playwright/playwright-report
```

### Using the Helper Script

```bash
# Run tests with helper script
./scripts/e2e-test.sh local          # Local tests
./scripts/e2e-test.sh docker         # Docker tests (builds and tears down)
./scripts/e2e-test.sh staging        # Staging tests

# Pass additional playwright options
./scripts/e2e-test.sh local --ui     # Open UI mode
./scripts/e2e-test.sh local --headed # Show browser
```

## CI/CD Integration

### Pull Requests (docker-test.yml)
- Runs automatically on all PRs to main branch
- Builds Docker image and runs container
- Executes E2E tests against Docker environment
- Uploads test artifacts on failure

### Staging Deployment (deploy-staging.yml)
- Triggered on push to main branch
- Deploys to staging environment
- Runs E2E tests against staging after deployment
- Automatic rollback if tests fail
- Preserves previous working version for quick recovery

## Writing New Tests

```typescript
import { test, expect } from '@playwright/test';

test.describe('Feature Name', () => {
  test('should do something', async ({ page }) => {
    await page.goto('/path');
    
    // Add your test logic
    await expect(page.locator('h1')).toContainText('Expected Text');
  });
});
```

## Debugging Failed Tests

1. **View trace**: `bunx playwright show-trace .playwright/test-results/*/trace.zip`
2. **View report**: `bunx playwright show-report`
3. **Run with UI**: `bun run e2e:local:ui`
4. **Debug mode**: `bunx playwright test --debug`

## Configuration

See `playwright.config.ts` for full configuration options.

Key settings:
- **Timeout**: 30 seconds per test
- **Retries**: 2 on CI, 0 locally
- **Artifacts**: Screenshots, videos, and traces on failure
- **Browsers**: Chromium by default (can add Firefox, WebKit)
