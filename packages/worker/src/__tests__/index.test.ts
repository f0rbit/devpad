import { describe, expect, it } from "bun:test";
import worker from "../index.js";

const MOCK_ENV = {
	DB: {} as any,
	BLOG_CORPUS_BUCKET: {} as any,
	MEDIA_CORPUS_BUCKET: {} as any,
	ENVIRONMENT: "test",
	API_URL: "http://localhost:8787",
	FRONTEND_URL: "http://localhost:3000",
	GITHUB_CLIENT_ID: "test-client-id",
	GITHUB_CLIENT_SECRET: "test-client-secret",
	JWT_SECRET: "test-jwt-secret",
	ENCRYPTION_KEY: "test-encryption-key",
};

const request = (path: string, options?: RequestInit) => new Request(`http://localhost${path}`, options);

describe("health endpoint", () => {
	it("returns ok status", async () => {
		const response = await worker.fetch(request("/health"), MOCK_ENV as never, {} as never);
		const body = await response.json();
		expect(response.status).toBe(200);
		expect(body).toEqual({ status: "ok" });
	});
});

describe("routing", () => {
	it("returns devpad message for root", async () => {
		const response = await worker.fetch(request("/"), MOCK_ENV as never, {} as never);
		const body = (await response.json()) as any;
		expect(response.status).toBe(200);
		expect(body).toHaveProperty("message", "devpad — Cloudflare Worker");
		expect(body).toHaveProperty("version", "1.0.0");
	});

	it("returns 501 for blog subdomain", async () => {
		const req = new Request("http://blog.devpad.tools/", { headers: { host: "blog.devpad.tools" } });
		const response = await worker.fetch(req, MOCK_ENV as never, {} as never);
		expect(response.status).toBe(501);
		const body = (await response.json()) as any;
		expect(body.message).toContain("Phase 2");
	});

	it("returns 501 for media subdomain", async () => {
		const req = new Request("http://media.devpad.tools/", { headers: { host: "media.devpad.tools" } });
		const response = await worker.fetch(req, MOCK_ENV as never, {} as never);
		expect(response.status).toBe(501);
		const body = (await response.json()) as any;
		expect(body.message).toContain("Phase 2");
	});
});
