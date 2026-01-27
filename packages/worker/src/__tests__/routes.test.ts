import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import type { AppContext } from "../bindings.js";
import { requireAuth } from "../middleware/auth.js";

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

const createTestApp = () => {
	const app = new Hono<AppContext>();

	app.get("/health", c => c.json({ status: "ok" }));

	app.use("/api/*", async (c, next) => {
		c.set("db", {} as any);
		c.set("user", null);
		c.set("session", null);
		await next();
	});

	app.get("/api/v1/", c => c.json({ version: "1", status: "ok" }));

	app.get("/api/v1/projects", requireAuth, async c => {
		return c.json([]);
	});

	app.get("/api/auth/session", async c => {
		const user = c.get("user");
		const session = c.get("session");
		if (!user || !session) {
			return c.json({ authenticated: false, user: null, session: null });
		}
		return c.json({ authenticated: true, user, session: { id: session.id } });
	});

	app.get("/api/auth/verify", async c => {
		const user = c.get("user");
		if (!user) return c.json({ authenticated: false, user: null }, 200);
		return c.json({ authenticated: true, user });
	});

	app.all("*", c => {
		return c.json({ message: "devpad — Cloudflare Worker", version: "1.0.0" });
	});

	return app;
};

const request = (app: Hono<AppContext>, path: string, options?: RequestInit) => app.fetch(new Request(`http://localhost${path}`, options), MOCK_ENV as never, {} as never);

describe("worker route wiring", () => {
	const app = createTestApp();

	it("GET /health returns 200", async () => {
		const response = await request(app, "/health");
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body).toEqual({ status: "ok" });
	});

	it("GET /api/v1/ returns version info", async () => {
		const response = await request(app, "/api/v1/");
		expect(response.status).toBe(200);
		const body = (await response.json()) as any;
		expect(body.version).toBe("1");
		expect(body.status).toBe("ok");
	});

	it("GET /api/v1/projects without auth returns 401", async () => {
		const response = await request(app, "/api/v1/projects");
		expect(response.status).toBe(401);
		const body = (await response.json()) as any;
		expect(body.error).toBe("Unauthorized");
	});

	it("GET /api/auth/session without auth returns unauthenticated", async () => {
		const response = await request(app, "/api/auth/session");
		expect(response.status).toBe(200);
		const body = (await response.json()) as any;
		expect(body.authenticated).toBe(false);
		expect(body.user).toBeNull();
	});

	it("GET /api/auth/verify without auth returns unauthenticated", async () => {
		const response = await request(app, "/api/auth/verify");
		expect(response.status).toBe(200);
		const body = (await response.json()) as any;
		expect(body.authenticated).toBe(false);
		expect(body.user).toBeNull();
	});

	it("unknown routes return default response", async () => {
		const response = await request(app, "/some/unknown/path");
		expect(response.status).toBe(200);
		const body = (await response.json()) as any;
		expect(body.message).toBe("devpad — Cloudflare Worker");
		expect(body.version).toBe("1.0.0");
	});
});

describe("requireAuth middleware", () => {
	it("blocks unauthenticated requests with 401", async () => {
		const app = new Hono<AppContext>();
		app.use("*", async (c, next) => {
			c.set("db", {} as any);
			c.set("user", null);
			c.set("session", null);
			await next();
		});
		app.get("/protected", requireAuth, c => c.json({ ok: true }));

		const response = await app.fetch(new Request("http://localhost/protected"), MOCK_ENV as never, {} as never);
		expect(response.status).toBe(401);
	});

	it("allows authenticated requests through", async () => {
		const app = new Hono<AppContext>();
		app.use("*", async (c, next) => {
			c.set("db", {} as any);
			c.set("user", { id: "test-user", github_id: 12345, name: "Test", task_view: "list" as const });
			c.set("session", null);
			await next();
		});
		app.get("/protected", requireAuth, c => c.json({ ok: true }));

		const response = await app.fetch(new Request("http://localhost/protected"), MOCK_ENV as never, {} as never);
		expect(response.status).toBe(200);
		const body = (await response.json()) as any;
		expect(body.ok).toBe(true);
	});
});
