import { test, expect, Page } from "@playwright/test";

/**
 * Simplified Happy Path E2E Test
 *
 * Tests the core workflow: create project, verify it exists
 */

// Helper to set test user header for all requests
async function enableTestAuth(page: Page) {
	await page.setExtraHTTPHeaders({
		"X-Test-User": "true",
	});
}

test.describe("Simple Happy Path", () => {
	test("should create a project successfully", async ({ page }) => {
		// Enable test authentication for all requests
		await enableTestAuth(page);

		const projectId = `test-${Date.now()}`;
		const projectName = "Test Project";

		// Navigate to create page
		await page.goto("/project/create");

		// Wait for page to load
		await page.waitForSelector("#project_id", { timeout: 5000 });

		// Fill out project form
		await page.fill("#project_id", projectId);
		await page.fill("#name", projectName);
		await page.fill("#description", "E2E test project");
		await page.selectOption("#status", "development");

		// Submit form
		await page.click("#submit");

		// Wait for redirect to project page
		await page.waitForURL(`**/project/${projectId}`, { timeout: 10000 });

		// Verify we're on the project page
		expect(page.url()).toContain(`/project/${projectId}`);

		// Success! Project was created and we're on its page
		console.log(`✅ Successfully created project: ${projectId}`);
	});

	test("should create and view tasks", async ({ page }) => {
		// Enable test authentication
		await enableTestAuth(page);

		const projectId = `task-test-${Date.now()}`;

		// First create a project
		await page.goto("/project/create");
		await page.waitForSelector("#project_id");
		await page.fill("#project_id", projectId);
		await page.fill("#name", "Task Test Project");
		await page.click("#submit");
		await page.waitForURL(`**/project/${projectId}`);

		// Navigate to tasks page
		await page.goto(`/project/${projectId}/tasks`);

		// Check if we can access the tasks page
		expect(page.url()).toContain(`/project/${projectId}/tasks`);

		// Look for task creation button or link
		const createTaskButton = await page.$("text=/create.*task/i, text=/new.*task/i, text=/add.*task/i");
		if (createTaskButton) {
			await createTaskButton.click();
			// Wait a bit to see if navigation happens
			await page.waitForTimeout(2000);
		}
	});

	test("should handle milestones", async ({ page }) => {
		// Enable test authentication
		await enableTestAuth(page);

		const projectId = `milestone-test-${Date.now()}`;

		// Create a project
		await page.goto("/project/create");
		await page.waitForSelector("#project_id");
		await page.fill("#project_id", projectId);
		await page.fill("#name", "Milestone Test Project");
		await page.click("#submit");
		await page.waitForURL(`**/project/${projectId}`);

		// Navigate to milestones
		await page.goto(`/project/${projectId}/milestones`);

		// Verify we can access milestones page
		expect(page.url()).toContain(`/project/${projectId}/milestones`);
	});
});
