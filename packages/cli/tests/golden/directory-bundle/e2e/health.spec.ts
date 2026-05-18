import { expect, test } from "@playwright/test";

test("/health returns ok", async ({ request }) => {
	const response = await request.get("/health");
	expect(response.status()).toBe(200);
	const body = await response.json();
	expect(body.status).toBe("ok");
	expect(body.service).toBe("directory-bundle");
});

test("/version returns the package name", async ({ request }) => {
	const response = await request.get("/version");
	expect(response.status()).toBe(200);
	const body = await response.json();
	expect(body.name).toBe("directory-bundle");
});
