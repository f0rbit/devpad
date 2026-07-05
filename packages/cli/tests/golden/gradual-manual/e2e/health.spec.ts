import { expect, test } from "@playwright/test";
import { z } from "zod";

const HealthResponseSchema = z.object({ status: z.string(), service: z.string() });
const VersionResponseSchema = z.object({ name: z.string(), version: z.string() });

test("/health returns ok", async ({ request }) => {
	const response = await request.get("/health");
	expect(response.status()).toBe(200);
	const body = HealthResponseSchema.parse(await response.json());
	expect(body.status).toBe("ok");
	expect(body.service).toBe("gradual-manual");
});

test("/version returns the package name", async ({ request }) => {
	const response = await request.get("/version");
	expect(response.status()).toBe(200);
	const body = VersionResponseSchema.parse(await response.json());
	expect(body.name).toBe("gradual-manual");
});
