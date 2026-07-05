import { defineConfig } from "@playwright/test";

/**
 * E2E test configuration for multiple environments:
 * - local: Run against local dev server (packages/worker)
 * - staging: Run against staging deployment (Cloudflare Workers)
 *
 * Set TEST_ENV environment variable to switch between environments
 */

const TEST_ENV = process.env.TEST_ENV || "local";

// Environment-specific configurations
//
// Local dev is TWO servers: the Astro frontend serves PAGES on :3000 and proxies
// /api + /health to the worker on :3001 (apps/main/astro.config.mjs). The worker
// serves ONLY /api/v1 + /health and 404s page routes. Both must boot for the page
// suite to render, so `webServer` is an array. NODE_ENV=test on the Astro process
// enables the fake-auth middleware (apps/main/src/middleware.ts) which resolves the
// fake user to id "test-user-e2e".
const environments = {
	local: {
		baseURL: "http://localhost:3000",
		webServer: [
			{
				command: "bun run --filter=@devpad/app dev",
				url: "http://localhost:3000",
				env: {
					NODE_ENV: "test",
					PORT: "3000",
					PUBLIC_API_SERVER_URL: "http://localhost:3001/api/v1",
				},
				reuseExistingServer: !process.env.CI,
				timeout: 120 * 1000,
				stdout: "pipe" as const,
				stderr: "pipe" as const,
			},
			{
				command: "cd packages/worker && DATABASE_FILE=../../database/test.db bun run dev",
				url: "http://localhost:3001/health",
				reuseExistingServer: !process.env.CI,
				timeout: 120 * 1000,
				stdout: "pipe" as const,
				stderr: "pipe" as const,
			},
		],
	},
	staging: {
		baseURL: process.env.STAGING_URL || "https://staging.devpad.tools",
		webServer: undefined, // Testing against deployed staging
	},
};

const config = environments[TEST_ENV as keyof typeof environments];

if (!config) {
	throw new Error(`Invalid TEST_ENV: ${TEST_ENV}. Must be one of: local, staging`);
}

export default defineConfig({
	testDir: "./tests/e2e",
	/* Run tests in files in parallel */
	fullyParallel: true,
	/* Fail the build on CI if you accidentally left test.only in the source code. */
	forbidOnly: !!process.env.CI,
	/* Retry on CI only */
	retries: process.env.CI ? 2 : 0,
	/* Opt out of parallel tests on CI. */
	workers: process.env.CI ? 1 : undefined,
	/* Global timeout for each test */
	timeout: 45 * 1000,
	/* Global test timeout */
	globalTimeout: 10 * 60 * 1000, // 10 minutes
	/* Reporter to use. See https://playwright.dev/docs/test-reporters */
	reporter: process.env.CI
		? [["html", { outputFolder: ".playwright/playwright-report", open: "never" }], ["list"], ["github"]]
		: [["html", { outputFolder: ".playwright/playwright-report", open: "never" }], ["list"]],

	/* Shared settings for all projects */
	use: {
		/* Base URL to use in actions like `await page.goto('/')` */
		baseURL: config.baseURL,
		/* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
		trace: "on-first-retry",
	},

	/* Run your local dev server before starting the tests (only for local environment) */
	webServer: config.webServer,
});
