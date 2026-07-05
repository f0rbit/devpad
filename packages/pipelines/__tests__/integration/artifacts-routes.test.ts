/**
 * @module pipelines/__tests__/integration/artifacts-routes
 *
 * Covers the bearer-gated artifact upload surface added in Task 5.A:
 *
 * - `POST /artifacts/blob`        — store an `application/octet-stream`
 *   payload in a named corpus store keyed by `<store_id>/<content_hash>`.
 * - `POST /artifacts/version-set` — store a `VersionSetManifest` body
 *   via the `version_set_store` factory and return the assigned
 *   `version_set_id`.
 *
 * Auth model: a bearer token bound at the env level
 * (`env.PIPELINES_TOKEN.get()`). Read-only routes (`POST /runs`,
 * `GET /runs`, `/health`) stay unauthenticated.
 */

import { describe, expect, test } from "bun:test";
import { type Backend, create_memory_backend, type VersionSetManifest, version_set_store } from "@f0rbit/corpus";
import type { AuthError, AuthIdentity } from "../../src/auth.ts";
import { is_bearer_valid, parse_bearer_header } from "../../src/auth.ts";
import { type AuthGate, make_routes, type PulseEmitterLite, type RoutesDeps } from "../../src/routes.ts";

const valid_manifest: VersionSetManifest = {
	package: "test-pkg",
	git_sha: "0123456789abcdef0123456789abcdef01234567",
	created_at: "2026-05-17T00:00:00.000Z",
	builds: { worker: { artifact_ref: "worker-bundles/abc", size_bytes: 1024, compatibility_date: "2025-01-01" } },
	migrations: { do_migrations: [] },
	env_manifest_ref: "env-manifests/abc",
	infra_plan_ref: "infra-plans/abc",
};

const PIPELINES_TOKEN = "test-token-AAAAAAAAAA";

const build_routes_deps = (
	overrides: Partial<RoutesDeps> = {},
): { app: ReturnType<typeof make_routes>; backend: Backend; emitted: Array<Record<string, unknown>> } => {
	const backend = overrides.backend ?? create_memory_backend();
	const auth: AuthGate<AuthIdentity> = overrides.auth ?? {
		check: async (request) => {
			const header = request.headers.get("authorization");
			if (!is_bearer_valid(header, PIPELINES_TOKEN))
				return {
					ok: false as const,
					error: { code: "unauthorized" as const, message: "bad token" } satisfies AuthError,
				};
			return { ok: true as const, value: { kind: "admin" as const, reason: "pipelines_token" as const } };
		},
	};
	const emitted: Array<Record<string, unknown>> = [];
	const pulse: PulseEmitterLite = overrides.pulse ?? {
		emit: async (event) => {
			emitted.push(event as Record<string, unknown>);
			return undefined;
		},
	};
	const deps: RoutesDeps = {
		db: {} as never,
		do_router: { get: () => ({ fetch: async () => new Response("", { status: 500 }) }) },
		manifests: { get: async () => null },
		templates: { resolve: async () => null },
		lineage: { previous: async () => null },
		backend,
		auth,
		pulse,
		...overrides,
	};
	return { app: make_routes(() => deps), backend, emitted };
};

const auth_header = (token: string) => `Bearer ${token}`;

const post_blob = (app: ReturnType<typeof make_routes>, body: Uint8Array | string, headers: Record<string, string>) =>
	app.fetch(
		new Request("http://run.local/artifacts/blob", {
			method: "POST",
			headers: { "content-type": "application/octet-stream", ...headers },
			body,
		}),
	);

const post_manifest = (app: ReturnType<typeof make_routes>, body: unknown, headers: Record<string, string>) =>
	app.fetch(
		new Request("http://run.local/artifacts/version-set", {
			method: "POST",
			headers: { "content-type": "application/json", ...headers },
			body: typeof body === "string" ? body : JSON.stringify(body),
		}),
	);

describe("auth helpers", () => {
	test("parse_bearer_header extracts the token", () => {
		expect(parse_bearer_header("Bearer abc-123")).toBe("abc-123");
	});

	test("parse_bearer_header rejects missing / wrong scheme", () => {
		expect(parse_bearer_header(null)).toBeNull();
		expect(parse_bearer_header("Basic abc")).toBeNull();
		expect(parse_bearer_header("Bearer ")).toBeNull();
	});

	test("is_bearer_valid is exact-match on token bytes", () => {
		expect(is_bearer_valid("Bearer right", "right")).toBe(true);
		expect(is_bearer_valid("Bearer wrong", "right")).toBe(false);
		expect(is_bearer_valid("Bearer righ", "right")).toBe(false); // shorter
		expect(is_bearer_valid("Bearer rightt", "right")).toBe(false); // longer
		expect(is_bearer_valid(null, "right")).toBe(false);
	});
});

describe("POST /artifacts/blob", () => {
	test("rejects missing Authorization with 401", async () => {
		const { app } = build_routes_deps();
		const res = await post_blob(app, new Uint8Array([1, 2, 3]), { "x-store-id": "worker-bundles" });
		expect(res.status).toBe(401);
		const body = (await res.json()) as { ok: boolean; error: { code: string } };
		expect(body.ok).toBe(false);
		expect(body.error.code).toBe("unauthorized");
	});

	test("rejects wrong token with 401", async () => {
		const { app } = build_routes_deps();
		const res = await post_blob(app, new Uint8Array([1, 2, 3]), {
			authorization: auth_header("wrong-token-AAAAAAAA"),
			"x-store-id": "worker-bundles",
		});
		expect(res.status).toBe(401);
	});

	test("rejects missing x-store-id with 400", async () => {
		const { app } = build_routes_deps();
		const res = await post_blob(app, new Uint8Array([1, 2, 3]), { authorization: auth_header(PIPELINES_TOKEN) });
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("invalid_store_id");
	});

	test("rejects malformed x-store-id with 400", async () => {
		const { app } = build_routes_deps();
		const res = await post_blob(app, new Uint8Array([1, 2, 3]), {
			authorization: auth_header(PIPELINES_TOKEN),
			"x-store-id": "Worker Bundles!",
		});
		expect(res.status).toBe(400);
	});

	test("happy path stores bytes and returns the ref", async () => {
		const { app, backend, emitted } = build_routes_deps();
		const payload = new TextEncoder().encode("hello world");
		const res = await post_blob(app, payload, {
			authorization: auth_header(PIPELINES_TOKEN),
			"x-store-id": "worker-bundles",
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			ok: boolean;
			value: { version: string; content_hash: string; store_id: string; ref: string };
		};
		expect(body.ok).toBe(true);
		expect(body.value.store_id).toBe("worker-bundles");
		expect(body.value.content_hash).toMatch(/^[a-f0-9]{64}$/);
		expect(body.value.ref).toBe(`worker-bundles/${body.value.content_hash}`);

		// Backend received the bytes
		const fetched = await backend.data.get(body.value.ref);
		expect(fetched.ok).toBe(true);
		if (fetched.ok) {
			const stored = await fetched.value.bytes();
			expect(new TextDecoder().decode(stored)).toBe("hello world");
		}

		// And the metadata
		const meta = await backend.metadata.get("worker-bundles", body.value.version);
		expect(meta.ok).toBe(true);

		// And the pulse event fired
		expect(emitted).toHaveLength(1);
		expect(emitted[0]).toMatchObject({ event: "artifact_uploaded", store_id: "worker-bundles", kind: "blob" });
	});

	test("rejects oversized payload with 413 (via content-length header)", async () => {
		const { app } = build_routes_deps();
		const res = await app.fetch(
			new Request("http://run.local/artifacts/blob", {
				method: "POST",
				headers: {
					authorization: auth_header(PIPELINES_TOKEN),
					"x-store-id": "worker-bundles",
					"content-type": "application/octet-stream",
					"content-length": String(30 * 1024 * 1024),
				},
				body: new Uint8Array([0]),
			}),
		);
		expect(res.status).toBe(413);
	});
});

describe("POST /artifacts/version-set", () => {
	test("rejects missing Authorization with 401", async () => {
		const { app } = build_routes_deps();
		const res = await post_manifest(app, valid_manifest, {});
		expect(res.status).toBe(401);
	});

	test("rejects malformed JSON with 400", async () => {
		const { app } = build_routes_deps();
		const res = await post_manifest(app, "not json{", { authorization: auth_header(PIPELINES_TOKEN) });
		expect(res.status).toBe(400);
	});

	test("rejects manifest failing schema with 400", async () => {
		const { app } = build_routes_deps();
		const bad = { ...valid_manifest, git_sha: "too-short" };
		const res = await post_manifest(app, bad, { authorization: auth_header(PIPELINES_TOKEN) });
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("invalid_manifest");
	});

	test("happy path stores the manifest and round-trips via version_set_store", async () => {
		const { app, backend, emitted } = build_routes_deps();
		const res = await post_manifest(app, valid_manifest, { authorization: auth_header(PIPELINES_TOKEN) });
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			ok: boolean;
			value: { version_set_id: string; content_hash: string; package: string };
		};
		expect(body.ok).toBe(true);
		expect(body.value.package).toBe("test-pkg");
		expect(body.value.content_hash).toMatch(/^[a-f0-9]{64}$/);

		// Retrieve via the same store factory the orchestrator uses
		const store = version_set_store(backend);
		const fetched = await store.store.get(body.value.version_set_id);
		expect(fetched.ok).toBe(true);
		if (fetched.ok) {
			expect(fetched.value.data.package).toBe("test-pkg");
			expect(fetched.value.data.git_sha).toBe(valid_manifest.git_sha);
		}

		// Pulse hook fired
		expect(emitted).toHaveLength(1);
		expect(emitted[0]).toMatchObject({ event: "artifact_uploaded", kind: "version_set", package: "test-pkg" });
	});

	test("auth gate marked unavailable returns 503", async () => {
		const { app } = build_routes_deps({
			auth: { check: async () => ({ ok: false, error: { code: "auth_unavailable", message: "no secret bound" } }) },
		});
		const res = await post_manifest(app, valid_manifest, { authorization: auth_header(PIPELINES_TOKEN) });
		expect(res.status).toBe(503);
	});

	test("second put for the same package stamps the previous version as parent so lineage walks back", async () => {
		const { app, backend } = build_routes_deps();

		// Upload A
		const res_a = await post_manifest(app, valid_manifest, { authorization: auth_header(PIPELINES_TOKEN) });
		expect(res_a.status).toBe(200);
		const body_a = (await res_a.json()) as { ok: true; value: { version_set_id: string } };

		// Upload B for the same package (different git_sha so dedup doesn't collapse).
		// Memory backend's created_at comes from Date.now() — a 2ms delay
		// guarantees B's created_at > A's even on fast machines so the
		// "latest" lookup picks A as B's parent.
		await new Promise((r) => setTimeout(r, 2));
		const manifest_b: VersionSetManifest = { ...valid_manifest, git_sha: "fedcba9876543210fedcba9876543210fedcba98" };
		const res_b = await post_manifest(app, manifest_b, { authorization: auth_header(PIPELINES_TOKEN) });
		expect(res_b.status).toBe(200);
		const body_b = (await res_b.json()) as { ok: true; value: { version_set_id: string } };

		// Lineage from B should be [B, A]
		const store = version_set_store(backend);
		const chain = await store.lineage(body_b.value.version_set_id);
		expect(chain.ok).toBe(true);
		if (!chain.ok) return;
		expect(chain.value.map((r) => r.version)).toEqual([body_b.value.version_set_id, body_a.value.version_set_id]);
		expect(chain.value.every((r) => r.package === "test-pkg")).toBe(true);
	});

	test("first put for a fresh package has empty parents (lineage = [self])", async () => {
		const { app, backend } = build_routes_deps();
		const fresh: VersionSetManifest = { ...valid_manifest, package: "fresh-pkg" };
		const res = await post_manifest(app, fresh, { authorization: auth_header(PIPELINES_TOKEN) });
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: true; value: { version_set_id: string } };

		const store = version_set_store(backend);
		const chain = await store.lineage(body.value.version_set_id);
		expect(chain.ok).toBe(true);
		if (!chain.ok) return;
		expect(chain.value).toHaveLength(1);
		expect(chain.value[0]?.version).toBe(body.value.version_set_id);
	});

	test("parent lookup is scoped to the package — uploads for a different package are not picked up as parents", async () => {
		const { app, backend } = build_routes_deps();
		// Upload one for pkg-a
		const a_first = await post_manifest(
			app,
			{ ...valid_manifest, package: "pkg-a" },
			{ authorization: auth_header(PIPELINES_TOKEN) },
		);
		expect(a_first.status).toBe(200);
		await new Promise((r) => setTimeout(r, 2));
		// Then an UNRELATED package — should NOT inherit a parent from pkg-a
		const b_first = await post_manifest(
			app,
			{ ...valid_manifest, package: "pkg-b" },
			{ authorization: auth_header(PIPELINES_TOKEN) },
		);
		expect(b_first.status).toBe(200);
		const body = (await b_first.json()) as { ok: true; value: { version_set_id: string } };

		const store = version_set_store(backend);
		const chain = await store.lineage(body.value.version_set_id);
		expect(chain.ok).toBe(true);
		if (!chain.ok) return;
		// pkg-b's lineage stays at length 1 — pkg-a's snapshot must not leak in
		expect(chain.value).toHaveLength(1);
		expect(chain.value[0]?.package).toBe("pkg-b");
	});
});
