import { expect, test } from "@playwright/test";

test("/health returns ok", async ({ request }) => {
	const response = await request.get("/health");
	expect(response.status()).toBe(200);
	const body = (await response.json()) as { status: string; service: string };
	expect(body.status).toBe("ok");
	expect(body.service).toBe("gradual-manual");
});

test("/version returns the package name", async ({ request }) => {
	const response = await request.get("/version");
	expect(response.status()).toBe(200);
	const body = (await response.json()) as { name: string; version: string };
	expect(body.name).toBe("gradual-manual");
});
