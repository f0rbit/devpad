import { defineConfig } from "@playwright/test";

/**
 * E2E test configuration for multiple environments:
 * - local: Run against local dev server (bun start in packages/server)
 * - docker: Run against Docker Compose setup (used in CI for PRs)
 * - staging: Run against staging deployment (after deploy to main)
 *
 * Set TEST_ENV environment variable to switch between environments
 */

const TEST_ENV = process.env.TEST_ENV || "local";

// Environment-specific configurations
const environments = {
	local: {
		baseURL: "http://localhost:3001",
		webServer: {
			command: "cd packages/server && DATABASE_FILE=../../database/test.db bun start",
			url: "http://localhost:3001",
			reuseExistingServer: !process.env.CI,
			timeout: 60 * 1000,
			stdout: "pipe" as const,
			stderr: "pipe" as const,
		},
	},
	docker: {
		baseURL: "http://0.0.0.0:3000",
		webServer: undefined, // Docker Compose should be running externally
	},
	staging: {
		baseURL: process.env.STAGING_URL || "https://staging.devpad.tools",
		webServer: undefined, // Testing against deployed staging
	},
};

const config = environments[TEST_ENV as keyof typeof environments];

if (!config) {
	throw new Error(`Invalid TEST_ENV: ${TEST_ENV}. Must be one of: local, docker, staging`);
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
	reporter: process.env.CI ? [["html", { outputFolder: ".playwright/playwright-report", open: "never" }], ["list"], ["github"]] : [["html", { outputFolder: ".playwright/playwright-report", open: "never" }], ["list"]],

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
