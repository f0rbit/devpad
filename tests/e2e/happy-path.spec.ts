import { test, expect, Page } from "@playwright/test";

/**
 * Happy Path E2E Test Suite
 *
 * Tests the complete user workflow from project creation to task management.
 * Uses mock authentication injected at the server level for TEST environment.
 */

// Helper to set test user header for all requests
async function enableTestAuth(page: Page) {
	await page.setExtraHTTPHeaders({
		"X-Test-User": "true",
	});
}

test.describe("Happy Path Workflow", () => {
	test("should complete the full happy path workflow", async ({ page }) => {
		// Enable test authentication for all requests
		await enableTestAuth(page);

		const projectId = `test-project-${Date.now()}`;
		const projectName = "Test Project";
		const taskNames = ["Implement user authentication", "Add database migrations"];
		const milestoneName = "MVP Release";
		const goalNames = ["Core Features", "Infrastructure Setup"];

		await test.step("Navigate to homepage", async () => {
			await page.goto("/");
			await expect(page).toHaveTitle(/devpad/i);
		});

		await test.step("Create new project", async () => {
			// Navigate to project creation page
			await page.goto("/project/create");

			// Wait for page to load (check for project_id field)
			await page.waitForSelector("#project_id", { timeout: 5000 });

			// Fill out project form using IDs
			await page.fill("#project_id", projectId);
			await page.fill("#name", projectName);
			await page.fill("#description", "This is a test project for E2E testing");

			// Select development status using ID
			await page.selectOption("#status", "development");

			// Submit form - the button is actually an anchor with role="button"
			await page.click("#submit");

			// Should redirect to project page
			await page.waitForURL(`**/project/${projectId}`, { timeout: 5000 });

			// Verify we're on the project page
			expect(page.url()).toContain(`/project/${projectId}`);
		});

		await test.step("Create tasks", async () => {
			// Navigate to tasks page
			await page.goto(`/project/${projectId}/tasks`);

			for (const taskName of taskNames) {
				// Click create task button
				const createButton = await page.$('button:has-text("Create Task"), a:has-text("Create Task"), button:has-text("New Task"), a:has-text("New Task"), button:has-text("Add Task"), a:has-text("Add Task")');
				if (createButton) {
					await createButton.click();
				} else {
					// Try navigating directly
					await page.goto(`/project/${projectId}/tasks/create`);
				}

				// Wait for form
				await page.waitForSelector('input[name="title"], input[name="name"]', { timeout: 5000 });

				// Fill task form
				const titleInput = (await page.$('input[name="title"]')) || (await page.$('input[name="name"]'));
				if (titleInput) {
					await titleInput.fill(taskName);
				}

				// Add description if field exists
				const descriptionField = await page.$('textarea[name="description"]');
				if (descriptionField) {
					await descriptionField.fill(`Description for ${taskName}`);
				}

				// Submit
				await page.click('button[type="submit"]');

				// Wait for redirect or success
				await page.waitForTimeout(1000);
			}

			// Verify tasks were created
			await page.goto(`/project/${projectId}/tasks`);
			for (const taskName of taskNames) {
				await expect(page.locator(`text=${taskName}`)).toBeVisible();
			}
		});

		await test.step("Create milestone with goals", async () => {
			// Navigate to milestones page
			await page.goto(`/project/${projectId}/milestones`);

			// Create milestone
			const createMilestoneButton = await page.$('button:has-text("Create Milestone"), a:has-text("Create Milestone"), button:has-text("New Milestone"), a:has-text("New Milestone")');
			if (createMilestoneButton) {
				await createMilestoneButton.click();
			} else {
				await page.goto(`/project/${projectId}/milestones/create`);
			}

			// Fill milestone form
			await page.waitForSelector('input[name="name"], input[name="title"]', { timeout: 5000 });
			const nameInput = (await page.$('input[name="name"]')) || (await page.$('input[name="title"]'));
			if (nameInput) {
				await nameInput.fill(milestoneName);
			}

			// Add description
			const descField = await page.$('textarea[name="description"]');
			if (descField) {
				await descField.fill("Major milestone for the MVP release");
			}

			// Set target date if field exists
			const dateField = await page.$('input[type="date"]');
			if (dateField) {
				const futureDate = new Date();
				futureDate.setMonth(futureDate.getMonth() + 1);
				await dateField.fill(futureDate.toISOString().split("T")[0]);
			}

			// Submit milestone
			await page.click('button[type="submit"]');
			await page.waitForTimeout(1000);

			// Create goals within the milestone
			for (const goalName of goalNames) {
				// Try to find add goal button
				const addGoalButton = await page.$('button:has-text("Add Goal"), a:has-text("Add Goal"), button:has-text("Create Goal"), a:has-text("Create Goal")');
				if (addGoalButton) {
					await addGoalButton.click();

					// Fill goal form
					await page.waitForSelector('input[name="name"], input[name="title"]', { timeout: 5000 });
					const goalNameInput = (await page.$('input[name="name"]')) || (await page.$('input[name="title"]'));
					if (goalNameInput) {
						await goalNameInput.fill(goalName);
					}

					// Submit goal
					await page.click('button[type="submit"]');
					await page.waitForTimeout(1000);
				}
			}
		});

		await test.step("Assign tasks to goals", async () => {
			// Navigate back to tasks
			await page.goto(`/project/${projectId}/tasks`);

			// For each task, try to assign to a goal
			for (let i = 0; i < taskNames.length && i < goalNames.length; i++) {
				const taskName = taskNames[i];
				const goalName = goalNames[i];

				// Click on the task to open details/edit
				await page.click(`text=${taskName}`);
				await page.waitForTimeout(500);

				// Look for goal assignment dropdown
				const goalSelect = await page.$('select[name="goal_id"], select[name="goal"]');
				if (goalSelect) {
					// Find and select the goal
					const options = await goalSelect.$$eval("option", opts => opts.map(opt => ({ value: opt.value, text: opt.textContent })));
					const goalOption = options.find(opt => opt.text?.includes(goalName));
					if (goalOption) {
						await goalSelect.selectOption(goalOption.value);
					}
				}

				// Save changes
				const saveButton = await page.$('button:has-text("Save"), button:has-text("Update")');
				if (saveButton) {
					await saveButton.click();
					await page.waitForTimeout(1000);
				}
			}
		});

		await test.step("Verify complete setup", async () => {
			// Go to project overview
			await page.goto(`/project/${projectId}`);

			// Verify project details are visible
			await expect(page.locator(`text=${projectName}`)).toBeVisible();

			// Verify we can see task count or task section
			const tasksSection = await page.$("text=/tasks?/i");
			expect(tasksSection).toBeTruthy();

			// Verify milestone section exists
			const milestonesSection = await page.$("text=/milestones?/i");
			expect(milestonesSection).toBeTruthy();
		});
	});

	test("should handle project creation form validation", async ({ page }) => {
		// Enable test authentication
		await enableTestAuth(page);

		await test.step("Test form validation", async () => {
			await page.goto("/project/create");

			// Wait for page to load
			await page.waitForSelector("#project_id", { timeout: 5000 });

			// Try to submit empty form
			await page.click("#submit");

			// Should show validation errors or stay on page
			// Check we're still on create page
			expect(page.url()).toContain("/project/create");

			// Fill only ID and try again
			await page.fill("#project_id", "test-validation");
			await page.click("#submit");

			// Should still need name
			expect(page.url()).toContain("/project/create");

			// Fill name and submit should work
			await page.fill("#name", "Validation Test Project");
			await page.click("#submit");

			// Should redirect away from create page
			await page.waitForURL("**/project/test-validation", { timeout: 5000 });
		});
	});
});

test.describe("Public Page Access", () => {
	test("should render public pages without authentication", async ({ page }) => {
		// Don't enable test auth for this test

		await test.step("Visit homepage", async () => {
			await page.goto("/");
			await expect(page).toHaveTitle(/devpad/i);
		});

		await test.step("Visit docs page", async () => {
			await page.goto("/docs");
			const bodyText = await page.textContent("body");
			expect(bodyText).toContain("This endpoint fetches the data associated with each project");
		});
	});

	test("should require authentication for protected routes", async ({ page }) => {
		// Don't enable test auth for this test

		await test.step("Try to access protected route", async () => {
			const response = await page.goto("/project/create");
			expect(response?.status()).toBe(401);
		});
	});
});
