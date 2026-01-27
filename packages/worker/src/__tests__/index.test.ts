import { describe, expect, it } from "bun:test";
import { createUnifiedWorker } from "../index.js";

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
	REDDIT_CLIENT_ID: "test-reddit-id",
	REDDIT_CLIENT_SECRET: "test-reddit-secret",
	TWITTER_CLIENT_ID: "test-twitter-id",
	TWITTER_CLIENT_SECRET: "test-twitter-secret",
};

const stub_astro_handler = (label: string) => ({
	fetch: async (_request: Request, _env: any, _ctx: ExecutionContext) =>
		new Response(JSON.stringify({ message: `${label} — Phase 2 — not yet wired` }), {
			status: 501,
			headers: { "Content-Type": "application/json" },
		}),
});

const devpad_handler = {
	fetch: async (request: Request, _env: any, _ctx: ExecutionContext) => {
		const url = new URL(request.url);
		if (url.pathname === "/") {
			return new Response(JSON.stringify({ message: "devpad — Cloudflare Worker", version: "1.0.0" }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}
		return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
	},
};

const worker = createUnifiedWorker({
	devpad: devpad_handler,
	blog: stub_astro_handler("blog"),
	media: stub_astro_handler("media"),
});

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
