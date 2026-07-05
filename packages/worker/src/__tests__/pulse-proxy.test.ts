import { afterEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import type { AppContext } from "../bindings.js";
import pulse_routes from "../routes/v1/pulse.js";

/**
 * Unit-level test for the `/v1/pulse/*` proxy route. We bypass the full
 * integration setup (which spins a Hono server + sqlite db on disk) and
 * instead build a minimal Hono app, inject the same context variables the
 * production middleware would set, and stub `globalThis.fetch` so we can
 * assert the upstream request shape.
 *
 * This covers:
 *   - Path/header rewriting (Authorization: Bearer <PULSE_INTERNAL_KEY>)
 *   - Owner-of-project enforcement (403 when stub says non-owner)
 *   - Auth required (401 when no user is set on context)
 *   - 503 short-circuit when pulse config is missing
 *
 * If devpad later grows a proper in-process worker harness, this can be
 * lifted into the integration suite — for now the unit-level shape is enough.
 */

type StubContext = {
	user_id: string | null;
	owns_project: boolean;
	pulse_api_base?: string;
	pulse_internal_key?: string;
};

type Captured = {
	url: string;
	method: string;
	headers: Record<string, string>;
	body: string | null;
};

const authz_header = (h: Record<string, string> | undefined): string | undefined => {
	if (!h) return undefined;
	for (const [k, v] of Object.entries(h)) {
		if (k.toLowerCase() === "authorization") return v;
	}
	return undefined;
};

const build_app = (
	stub: StubContext,
	upstream: (req: Captured) => Response,
): { app: Hono<AppContext>; captured: Captured[] } => {
	const captured: Captured[] = [];
	const original_fetch = globalThis.fetch;
	const fake_fetch: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
		const method = init?.method ?? (input instanceof Request ? input.method : "GET");
		const headers_obj: Record<string, string> = {};
		const headers_init = init?.headers ?? (input instanceof Request ? input.headers : undefined);
		if (headers_init instanceof Headers) {
			headers_init.forEach((v, k) => {
				headers_obj[k] = v;
			});
		} else if (Array.isArray(headers_init)) {
			for (const [k, v] of headers_init) headers_obj[k] = v;
		} else if (headers_init && typeof headers_init === "object") {
			for (const [k, v] of Object.entries(headers_init as Record<string, string>)) headers_obj[k] = v;
		}
		const body = typeof init?.body === "string" ? init.body : null;
		const cap: Captured = { url, method, headers: headers_obj, body };
		captured.push(cap);
		return upstream(cap);
	};
	globalThis.fetch = fake_fetch;

	// Stub project-ownership at the module boundary by injecting a tiny db
	// whose `select().from(...).where(...)` returns the right shape for
	// `doesUserOwnProject`.
	const stub_db = {
		select() {
			return {
				from() {
					return {
						where: async () => (stub.owns_project ? [{ id: "p", owner_id: stub.user_id }] : []),
					};
				},
			};
		},
	};

	const app = new Hono<AppContext>();
	app.use("*", async (c, next) => {
		c.set("db", stub_db as never);
		const config_stub = {
			environment: "test",
			api_url: "http://test",
			frontend_url: "http://test",
			jwt_secret: "x",
			encryption_key: "x",
			pulse_api_base: stub.pulse_api_base,
			pulse_internal_key: stub.pulse_internal_key,
		};
		c.set("config", config_stub as never);
		if (stub.user_id) {
			const user_stub = { id: stub.user_id, github_id: 1, name: "stub", task_view: "list" };
			c.set("user", user_stub as never);
			c.set("session", null);
			c.set("auth_channel", "api");
			c.set("api_key_scope", "pulse");
		} else {
			c.set("user", null as never);
			c.set("session", null);
			c.set("auth_channel", "user");
			c.set("api_key_scope", null);
		}
		await next();
	});
	app.route("/v1/pulse", pulse_routes);

	// Restore fetch after teardown — register a cleanup the test will explicitly call.
	(app as unknown as { restore_env: () => void }).restore_env = () => {
		globalThis.fetch = original_fetch;
	};

	return { app, captured };
};

const default_upstream = (status = 200, body: unknown = { ok: true }): ((req: Captured) => Response) => {
	return () =>
		new Response(JSON.stringify(body), {
			status,
			headers: { "content-type": "application/json" },
		});
};

describe("/v1/pulse/* proxy", () => {
	let teardown: (() => void) | null = null;

	afterEach(() => {
		teardown?.();
		teardown = null;
	});

	it("rewrites path + injects PULSE_INTERNAL_KEY header on summary", async () => {
		const { app, captured } = build_app(
			{
				user_id: "user_1",
				owns_project: true,
				pulse_api_base: "https://pulse.test",
				pulse_internal_key: "internal_secret",
			},
			default_upstream(200, { pageviews: 42 }),
		);
		teardown = (app as unknown as { restore_env: () => void }).restore_env;

		const res = await app.fetch(new Request("http://test/v1/pulse/summary/proj_abc?range=24h"));
		expect(res.status).toBe(200);
		const body: unknown = await res.json();
		expect((body as any).pageviews).toBe(42);

		expect(captured.length).toBe(1);
		expect(captured[0]?.url).toBe("https://pulse.test/summary/proj_abc?range=24h");
		expect(authz_header(captured[0]?.headers)).toBe("Bearer internal_secret");
	});

	it("returns 403 (no upstream call) when user does not own the project", async () => {
		const { app, captured } = build_app(
			{
				user_id: "user_1",
				owns_project: false,
				pulse_api_base: "https://pulse.test",
				pulse_internal_key: "internal_secret",
			},
			default_upstream(),
		);
		teardown = (app as unknown as { restore_env: () => void }).restore_env;

		const res = await app.fetch(new Request("http://test/v1/pulse/summary/proj_abc"));
		expect(res.status).toBe(403);
		expect(captured.length).toBe(0);
	});

	it("returns 401 (no upstream call) when no user is set on context", async () => {
		const { app, captured } = build_app(
			{
				user_id: null,
				owns_project: false,
				pulse_api_base: "https://pulse.test",
				pulse_internal_key: "internal_secret",
			},
			default_upstream(),
		);
		teardown = (app as unknown as { restore_env: () => void }).restore_env;

		const res = await app.fetch(new Request("http://test/v1/pulse/summary/proj_abc"));
		expect(res.status).toBe(401);
		expect(captured.length).toBe(0);
	});

	it("503s when PULSE_API_BASE / PULSE_INTERNAL_KEY are missing", async () => {
		const { app, captured } = build_app({ user_id: "user_1", owns_project: true }, default_upstream());
		teardown = (app as unknown as { restore_env: () => void }).restore_env;

		const res = await app.fetch(new Request("http://test/v1/pulse/summary/proj_abc"));
		expect(res.status).toBe(503);
		expect(captured.length).toBe(0);
	});

	it("forwards POST body and JSON content-type to /admin/subs", async () => {
		const { app, captured } = build_app(
			{
				user_id: "user_1",
				owns_project: true,
				pulse_api_base: "https://pulse.test",
				pulse_internal_key: "internal_secret",
			},
			(_: Captured) =>
				new Response(JSON.stringify({ id: "sub_xyz" }), {
					status: 201,
					headers: { "content-type": "application/json" },
				}),
		);
		teardown = (app as unknown as { restore_env: () => void }).restore_env;

		const res = await app.fetch(
			new Request("http://test/v1/pulse/admin/subs", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					project_id: "proj_abc",
					name: "x",
					filter: {},
					channel: { kind: "discord", webhook_url: "https://discord.test/x" },
				}),
			}),
		);
		expect(res.status).toBe(201);
		const body: unknown = await res.json();
		expect((body as any).id).toBe("sub_xyz");

		expect(captured.length).toBe(1);
		expect(captured[0]?.url).toBe("https://pulse.test/admin/subs");
		expect(captured[0]?.method).toBe("POST");
		expect(authz_header(captured[0]?.headers)).toBe("Bearer internal_secret");
		const sent: unknown = JSON.parse(captured[0]?.body ?? "{}");
		expect((sent as any).project_id).toBe("proj_abc");
	});

	it("DELETE /admin/keys/:id forwards project_id query and method", async () => {
		const { app, captured } = build_app(
			{
				user_id: "user_1",
				owns_project: true,
				pulse_api_base: "https://pulse.test",
				pulse_internal_key: "internal_secret",
			},
			(_: Captured) => new Response(null, { status: 204 }),
		);
		teardown = (app as unknown as { restore_env: () => void }).restore_env;

		const res = await app.fetch(
			new Request("http://test/v1/pulse/admin/keys/pkid_abc?project_id=proj_abc", {
				method: "DELETE",
			}),
		);
		expect(res.status).toBe(204);
		expect(captured[0]?.url).toBe("https://pulse.test/admin/keys/pkid_abc?project_id=proj_abc");
		expect(captured[0]?.method).toBe("DELETE");
	});

	it("maps upstream 503 to 503 'pulse_unreachable'", async () => {
		const { app } = build_app(
			{
				user_id: "user_1",
				owns_project: true,
				pulse_api_base: "https://pulse.test",
				pulse_internal_key: "internal_secret",
			},
			(_: Captured) =>
				new Response(JSON.stringify({ error: "down" }), {
					status: 503,
					headers: { "content-type": "application/json" },
				}),
		);
		teardown = (app as unknown as { restore_env: () => void }).restore_env;

		const res = await app.fetch(new Request("http://test/v1/pulse/summary/proj_abc"));
		expect(res.status).toBe(503);
		const body: unknown = await res.json();
		expect((body as any).error).toBe("pulse_unreachable");
	});
});
