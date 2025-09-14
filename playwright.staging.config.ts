import { defineConfig } from "@playwright/test";

/**
 * E2E test configuration for staging/production environments.
 * This configuration excludes tests that require fake user authentication
 * which only works in development/test environments.
 */

const TEST_ENV = process.env.TEST_ENV || "staging";

// Environment-specific configurations
const environments = {
	staging: {
		baseURL: process.env.STAGING_URL || "https://staging.devpad.tools",
		webServer: undefined, // Testing against deployed staging
	},
	production: {
		baseURL: process.env.PRODUCTION_URL || "https://devpad.tools",
		webServer: undefined, // Testing against deployed production
	},
};

const config = environments[TEST_ENV as keyof typeof environments];

if (!config) {
	throw new Error(`Invalid TEST_ENV: ${TEST_ENV}. Must be one of: staging, production`);
}

export default defineConfig({
	testDir: "./tests/e2e",
	/* Exclude tests that require fake user authentication */
	testIgnore: "**/happy-path.spec.ts",
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
	reporter: process.env.CI ? [["html", { outputFolder: ".playwright/playwright-report", open: "never" }], ["list"], ["github"]] : [["html", { outputFolder: ".playwright/report", open: "never" }], ["list"]],

	/* Shared settings for all projects */
	use: {
		/* Base URL to use in actions like `await page.goto('/')` */
		baseURL: config.baseURL,
		/* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
		trace: "on-first-retry",
	},

	/* No local web server for staging/production testing */
	webServer: config.webServer,
});
