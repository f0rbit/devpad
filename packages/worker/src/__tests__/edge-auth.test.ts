import { Database as BunSqlite } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { createBunDatabase, migrateBunDatabase } from "@devpad/schema/database/bun";
import { session, user } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { createUnifiedWorker } from "../index.js";
import { strip_internal_auth_headers } from "../lib/strip-internal-headers.js";

const ENV = {
	ENVIRONMENT: "test",
	API_URL: "http://localhost:8787",
	FRONTEND_URL: "http://localhost:3000",
	GITHUB_CLIENT_ID: "id",
	GITHUB_CLIENT_SECRET: "secret",
	JWT_SECRET: "jwt",
	ENCRYPTION_KEY: "key",
	REDDIT_CLIENT_ID: "id",
	REDDIT_CLIENT_SECRET: "secret",
	TWITTER_CLIENT_ID: "id",
	TWITTER_CLIENT_SECRET: "secret",
};

const noop_ctx: ExecutionContext = {
	waitUntil: () => {},
	passThroughOnException: () => {},
	props: {},
};

const FORGED = JSON.stringify({ id: "victim", github_id: 1, name: "victim", task_view: "list" });

const seed_session = async (): Promise<Database> => {
	const sqlite = new BunSqlite(":memory:");
	migrateBunDatabase(sqlite);
	const db = createBunDatabase(sqlite);
	await db.insert(user).values({ id: "real-user", github_id: 42, name: "real", email: "real@test.example" });
	await db.insert(session).values({
		id: "sess-1",
		userId: "real-user",
		expiresAt: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 29,
		access_token: "tok",
	});
	return db;
};

const capture = () => {
	const seen: Headers[] = [];
	const handler = {
		fetch: async (request: Request, _env: Record<string, unknown>, _ctx: ExecutionContext) => {
			seen.push(request.headers);
			return new Response("ok");
		},
	};
	return { seen, handler };
};

const build = (db?: Database) => {
	const { seen, handler } = capture();
	const worker = createUnifiedWorker({ devpad: handler, blog: handler, media: handler }, { open_db: () => db });
	return { seen, worker };
};

describe("strip_internal_auth_headers", () => {
	it("removes x-auth-*, x-devpad-* and x-test-user case-insensitively, keeps the rest", () => {
		const req = new Request("http://localhost/", {
			headers: {
				"X-Auth-User": FORGED,
				"x-AUTH-session-id": "s",
				"X-Devpad-Actor": "a",
				"X-Test-User": "true",
				Accept: "text/html",
				Cookie: "auth_session=abc",
			},
		});
		const clean = strip_internal_auth_headers(req);
		expect(Array.from(clean.headers.keys()).toSorted()).toEqual(["accept", "cookie"]);
	});

	it("does not mutate the original request and returns it untouched when nothing to strip", () => {
		const dirty = new Request("http://localhost/", { headers: { "X-Auth-User": FORGED } });
		strip_internal_auth_headers(dirty);
		expect(dirty.headers.get("x-auth-user")).toBe(FORGED);

		const plain = new Request("http://localhost/", { headers: { Accept: "*/*" } });
		expect(strip_internal_auth_headers(plain)).toBe(plain);
	});
});

describe("edge auth header trust", () => {
	it("forged X-Auth-User with no cookie never reaches the SSR handler", async () => {
		const db = await seed_session();
		const { seen, worker } = build(db);
		const res = await worker.fetch(
			new Request("http://localhost/", {
				headers: { "X-Auth-User": FORGED, "X-Auth-Session-Id": "forged", "X-Test-User": "true" },
			}),
			ENV,
			noop_ctx,
		);
		expect(res.status).toBe(200);
		expect(seen).toHaveLength(1);
		expect(seen[0]?.get("x-auth-user")).toBeNull();
		expect(seen[0]?.get("x-auth-session-id")).toBeNull();
		expect(seen[0]?.get("x-test-user")).toBeNull();
	});

	it("forged headers with an invalid session cookie are stripped too", async () => {
		const db = await seed_session();
		const { seen, worker } = build(db);
		const headers = { "X-Auth-User": FORGED, Cookie: "auth_session=nope" };
		await worker.fetch(new Request("http://localhost/", { headers }), ENV, noop_ctx);
		expect(seen[0]?.get("x-auth-user")).toBeNull();
	});

	it("forged headers with no DB available are stripped", async () => {
		const { seen, worker } = build(undefined);
		await worker.fetch(new Request("http://localhost/", { headers: { "X-Auth-User": FORGED } }), ENV, noop_ctx);
		expect(seen[0]?.get("x-auth-user")).toBeNull();
	});

	it("a valid session gets the server-set value even when the client also forged one", async () => {
		const db = await seed_session();
		const { seen, worker } = build(db);
		await worker.fetch(
			new Request("http://localhost/", {
				headers: { "X-Auth-User": FORGED, "X-Auth-Session-Id": "forged", Cookie: "auth_session=sess-1" },
			}),
			ENV,
			noop_ctx,
		);
		const header = seen[0]?.get("x-auth-user") ?? "";
		expect(header).not.toBe(FORGED);
		const parsed: unknown = JSON.parse(header);
		expect(parsed).toEqual({ id: "real-user", github_id: 42, name: "real", task_view: "list" });
		expect(seen[0]?.get("x-auth-session-id")).toBe("sess-1");
	});
});
