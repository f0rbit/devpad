import { test, expect } from "@playwright/test";

test.describe("Page Rendering", () => {
	test("should render homepage at /", async ({ page }) => {
		await page.goto("/");

		// Check that we get a valid HTML page
		const html = await page.content();
		expect(html).toContain("<!DOCTYPE html>");

		// Check for title
		await expect(page).toHaveTitle(/devpad/i);

		// Check that it's not an error page
		const bodyText = await page.textContent("body");
		expect(bodyText).not.toContain("Internal Server Error");
		expect(bodyText).not.toContain("404");
	});

	test("should render docs page at /docs", async ({ page }) => {
		const response = await page.goto("/docs");

		// Should return successful response
		expect(response?.status()).toBeLessThan(400);

		// Check that we get a valid HTML page
		const html = await page.content();
		expect(html).toContain("<!DOCTYPE html>");

		// Check that it's not an error page
		const bodyText = await page.textContent("body");
		expect(bodyText).toContain("This endpoint fetches the data associated with each project")
	});

	test("should render project landing page at /project", async ({ page }) => {
		const response = await page.goto("/project");

		// Should return successful response
		expect(response?.status()).toBeLessThan(400);

		// Check that we get a valid HTML page
		const html = await page.content();
		expect(html).toContain("<!DOCTYPE html>");

		// Check that it's not an error page
		const bodyText = await page.textContent("body");
		expect(bodyText).not.toContain("Internal Server Error");
	});

	test("should render todo page at /todo", async ({ page }) => {
		const response = await page.goto("/todo");

		// Should return successful response
		expect(response?.status()).toBeLessThan(400);

		// Check that we get a valid HTML page
		const html = await page.content();
		expect(html).toContain("<!DOCTYPE html>");

		// Check that it's not an error page
		const bodyText = await page.textContent("body");
		expect(bodyText).not.toContain("Internal Server Error");
	});
});
