# E2E Tests

End-to-end tests for devpad using Playwright.

## Quick Start

```bash
# Install Playwright browsers (first time only)
bunx playwright install chromium

# Run tests in different environments
bun run e2e:local      # Test against local server
bun run e2e:staging    # Test against staging environment
```

## Test Environments

### 1. Local Development (`TEST_ENV=local`)
- **URL**: http://localhost:3001
- **Setup**: Automatically starts server via `bun run dev` in packages/worker
- **Database**: Uses test database at `database/test.db`
- **Use Case**: Quick testing during development

### 2. Staging Environment (`TEST_ENV=staging`)
- **URL**: https://staging.devpad.tools
- **Setup**: Tests against deployed Cloudflare Workers staging
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
