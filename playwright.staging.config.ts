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

function isKnownEnv(value: string): value is keyof typeof environments {
	return value in environments;
}

if (!isKnownEnv(TEST_ENV)) {
	throw new Error(`Invalid TEST_ENV: ${TEST_ENV}. Must be one of: staging, production`);
}

const config = environments[TEST_ENV];

export default defineConfig({
	testDir: "./tests/e2e",
	/* Exclude tests that require fake user authentication */
	testIgnore: "**/happy-path.spec.ts",
	/* Run tests in files in parallel */
	fullyParallel: true,
	/* Fail the build on CI if you accidentally left test.only in the source code. */
	forbidOnly: !!process.env.CI,
	/* Retry once on CI. A test that only passes on retry is a FLAKE and fails the run
	   (failOnFlakyTests), so CI is red whenever a spec is unstable. Locally: 0. */
	retries: process.env.CI ? 1 : 0,
	/* Fail the CI run if any test is reported flaky (passed after a retry).
	   Playwright >= 1.43; default is already true when no retries are configured. */
	failOnFlakyTests: !!process.env.CI,
	/* Opt out of parallel tests on CI. */
	workers: process.env.CI ? 1 : undefined,
	/* Global timeout for each test */
	timeout: 45 * 1000,
	/* Global test timeout */
	globalTimeout: 10 * 60 * 1000, // 10 minutes
	/* Reporter to use. See https://playwright.dev/docs/test-reporters */
	reporter: process.env.CI
		? [["html", { outputFolder: ".playwright/playwright-report", open: "never" }], ["list"], ["github"]]
		: [["html", { outputFolder: ".playwright/report", open: "never" }], ["list"]],

	/* Shared settings for all projects */
	use: {
		/* Base URL to use in actions like `await page.goto('/')` */
		baseURL: config.baseURL,
		/* Keep a trace for the FAILED attempt even when a later retry passes, so a
		   flaky test's first failure (the one that fails the CI run) is inspectable. */
		trace: "retain-on-failure",
	},

	/* No local web server for staging/production testing */
	webServer: config.webServer,
});
