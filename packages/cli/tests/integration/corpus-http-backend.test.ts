/**
 * @module @devpad/cli/tests/integration/corpus-http-backend
 *
 * End-to-end test for the HTTP-backed corpus. Spins up a tiny in-process
 * HTTP server (`node:http`) implementing the orchestrator's
 * `/artifacts/*` contract against a real `create_memory_backend()` +
 * `version_set_store`. Points the CLI's `selectCorpusBackend({ mode:
 * "cloudflare-http" })` at the server and runs the manifest-upload
 * flow.
 *
 * What this asserts:
 * - The wire format the CLI emits is exactly what the orchestrator
 *   route accepts (envelope shape, header names, store-id parsing).
 * - The `version_set_store(backend).put(manifest)` path on the HTTP
 *   backend round-trips the manifest into the server's memory backend.
 * - Auth headers are present and rejected when missing.
 * - Arbitrary-store blob uploads work via `upload_blob_to_store` (the
 *   Task 5.D hook).
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import http from "node:http";
import { type Backend, create_memory_backend, type VersionSetManifest, version_set_store } from "@f0rbit/corpus";
import { selectCorpusBackend } from "../../src/corpus-backend";
import { upload_blob_to_store, upload_version_set } from "../../src/corpus-http-backend";

const VALID_TOKEN = "test-pipelines-token-XYZ";
const MAX_BLOB_SIZE_BYTES = 25 * 1024 * 1024;
const BLOB_STORE_ID_PATTERN = /^[a-z0-9-]{1,64}$/;

type ServerHandle = {
	server: http.Server;
	url: string;
	backend: Backend;
};

const sha256_hex = async (bytes: Uint8Array): Promise<string> => {
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	const view = new Uint8Array(digest);
	let out = "";
	for (let i = 0; i < view.length; i++) out += view[i].toString(16).padStart(2, "0");
	return out;
};

const generate_version = (): string => {
	const ts = Date.now().toString(36).padStart(9, "0");
	const rand = Math.floor(Math.random() * 0xffffff)
		.toString(16)
		.padStart(6, "0");
	return `v_${ts}_${rand}`;
};

const read_body = (req: http.IncomingMessage): Promise<Buffer> =>
	new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on("data", (c) => chunks.push(c));
		req.on("end", () => {
			resolve(Buffer.concat(chunks));
		});
		req.on("error", reject);
	});

const send_json = (res: http.ServerResponse, status: number, body: unknown): void => {
	res.statusCode = status;
	res.setHeader("content-type", "application/json");
	res.end(JSON.stringify(body));
};

const start_test_server = async (): Promise<ServerHandle> => {
	const backend = create_memory_backend();
	const handle_request = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
		try {
			const url = req.url ?? "/";
			const auth = req.headers.authorization ?? "";
			if (!url.startsWith("/artifacts/")) {
				send_json(res, 404, { ok: false, error: { code: "not_found" } });
				return;
			}
			if (!auth.startsWith("Bearer ") || auth.slice("Bearer ".length).trim() !== VALID_TOKEN) {
				send_json(res, 401, { ok: false, error: { code: "unauthorized", message: "bad token" } });
				return;
			}
			if (url === "/artifacts/blob" && req.method === "POST") {
				const store_id_header = req.headers["x-store-id"];
				const store_id = typeof store_id_header === "string" ? store_id_header : "";
				if (!BLOB_STORE_ID_PATTERN.test(store_id)) {
					send_json(res, 400, { ok: false, error: { code: "invalid_store_id" } });
					return;
				}
				const buf = await read_body(req);
				if (buf.byteLength > MAX_BLOB_SIZE_BYTES) {
					send_json(res, 413, { ok: false, error: { code: "payload_too_large" } });
					return;
				}
				const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
				const content_hash = await sha256_hex(bytes);
				const version = generate_version();
				const data_key = `${store_id}/${content_hash}`;
				const put_data = await backend.data.put(data_key, bytes);
				if (!put_data.ok) {
					send_json(res, 500, { ok: false, error: { code: "storage_error" } });
					return;
				}
				const put_meta = await backend.metadata.put({
					store_id,
					version,
					parents: [],
					created_at: new Date(),
					content_hash,
					content_type: "application/octet-stream",
					size_bytes: bytes.byteLength,
					data_key,
				});
				if (!put_meta.ok) {
					send_json(res, 500, { ok: false, error: { code: "storage_error" } });
					return;
				}
				send_json(res, 200, { ok: true, value: { version, content_hash, store_id, ref: data_key } });
				return;
			}
			if (url === "/artifacts/version-set" && req.method === "POST") {
				const buf = await read_body(req);
				let parsed_body: unknown = null;
				try {
					parsed_body = JSON.parse(buf.toString("utf8"));
				} catch {
					send_json(res, 400, { ok: false, error: { code: "invalid_body" } });
					return;
				}
				if (parsed_body === null || typeof parsed_body !== "object") {
					send_json(res, 400, { ok: false, error: { code: "invalid_body" } });
					return;
				}
				const manifest = parsed_body as VersionSetManifest;
				const store = version_set_store(backend);
				const put = await store.put(manifest);
				if (!put.ok) {
					send_json(res, 500, { ok: false, error: { code: "storage_error" } });
					return;
				}
				send_json(res, 200, {
					ok: true,
					value: { version_set_id: put.value.version, content_hash: put.value.content_hash, package: manifest.package },
				});
				return;
			}
			send_json(res, 404, { ok: false, error: { code: "not_found" } });
		} catch (e) {
			send_json(res, 500, { ok: false, error: { code: "internal", message: String(e) } });
		}
	};
	const server = http.createServer((req, res) => {
		void handle_request(req, res);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (address === null || typeof address === "string") throw new Error("listen failed");
	return { server, url: `http://127.0.0.1:${String(address.port)}`, backend };
};

const stop_test_server = async (h: ServerHandle): Promise<void> =>
	new Promise((resolve) =>
		h.server.close(() => {
			resolve();
		}),
	);

const valid_manifest = (overrides: Partial<VersionSetManifest> = {}): VersionSetManifest => ({
	package: "test-pkg",
	git_sha: "0123456789abcdef0123456789abcdef01234567",
	created_at: "2026-05-17T00:00:00.000Z",
	builds: { worker: { artifact_ref: "worker-bundles/abc", size_bytes: 1024, compatibility_date: "2025-01-01" } },
	migrations: { do_migrations: [] },
	env_manifest_ref: "env-manifests/abc",
	infra_plan_ref: "infra-plans/abc",
	...overrides,
});

describe("selectCorpusBackend", () => {
	test("memory mode (default with no env) returns a memory backend", async () => {
		const backend = await selectCorpusBackend({ mode: "memory" });
		const store = version_set_store(backend);
		const put = await store.put(valid_manifest());
		expect(put.ok).toBe(true);
	});

	test("auto-detect picks memory when env is empty", async () => {
		const prev_url = process.env.DEVPAD_PIPELINES_URL;
		const prev_token = process.env.DEVPAD_PIPELINES_TOKEN;
		delete process.env.DEVPAD_PIPELINES_URL;
		delete process.env.DEVPAD_PIPELINES_TOKEN;
		try {
			const backend = await selectCorpusBackend({});
			const store = version_set_store(backend);
			const put = await store.put(valid_manifest());
			expect(put.ok).toBe(true);
		} finally {
			if (prev_url !== undefined) process.env.DEVPAD_PIPELINES_URL = prev_url;
			if (prev_token !== undefined) process.env.DEVPAD_PIPELINES_TOKEN = prev_token;
		}
	});

	test("explicit cloudflare-http mode without env throws", async () => {
		// Not `.rejects.toThrow()` — bun-types declares `.rejects`/`.toThrow()` as
		// synchronous (`void`), which trips `await-thenable` +
		// `no-confusing-void-expression` even though the chain is genuinely
		// async at runtime. A plain try/catch stays honest to the types.
		let threw = false;
		try {
			await selectCorpusBackend({ mode: "cloudflare-http" });
		} catch {
			threw = true;
		}
		expect(threw).toBe(true);
	});
});

describe("HTTP corpus backend end-to-end", () => {
	let h: ServerHandle;

	beforeEach(async () => {
		h = await start_test_server();
	});

	afterEach(async () => {
		await stop_test_server(h);
	});

	test("upload_version_set round-trips through the server's corpus", async () => {
		const upload = await upload_version_set({ pipelines_url: h.url, pipelines_token: VALID_TOKEN }, valid_manifest());
		expect(upload.ok).toBe(true);
		if (!upload.ok) return;
		expect(upload.value.package).toBe("test-pkg");
		const store = version_set_store(h.backend);
		const fetched = await store.store.get(upload.value.version_set_id);
		expect(fetched.ok).toBe(true);
		if (fetched.ok) expect(fetched.value.data.git_sha).toBe(valid_manifest().git_sha);
	});

	test("upload_version_set with wrong token returns http 401 error", async () => {
		const upload = await upload_version_set({ pipelines_url: h.url, pipelines_token: "wrong-token" }, valid_manifest());
		expect(upload.ok).toBe(false);
		if (!upload.ok) {
			expect(upload.error.kind).toBe("http");
			if (upload.error.kind === "http") expect(upload.error.status).toBe(401);
		}
	});

	test("upload_blob_to_store stores arbitrary bytes (5.D hook)", async () => {
		const bytes = new TextEncoder().encode("compiled template body");
		const upload = await upload_blob_to_store(
			{ pipelines_url: h.url, pipelines_token: VALID_TOKEN },
			"pipeline-templates",
			bytes,
		);
		expect(upload.ok).toBe(true);
		if (!upload.ok) return;
		expect(upload.value.store_id).toBe("pipeline-templates");
		expect(upload.value.ref).toBe(`pipeline-templates/${upload.value.content_hash}`);
		// Server's backend retains the bytes
		const fetched = await h.backend.data.get(upload.value.ref);
		expect(fetched.ok).toBe(true);
		if (fetched.ok) {
			const stored = await fetched.value.bytes();
			expect(new TextDecoder().decode(stored)).toBe("compiled template body");
		}
	});

	test("CLI backend selector → version_set_store.put forwards manifest to the server", async () => {
		// In HTTP mode the CLI's preferred upload path is `upload_version_set`
		// (called from the `pipelines artifacts upload` action). The
		// `version_set_store(backend).put(...)` path still works as a
		// transparent forwarder — it just round-trips through the HTTP
		// backend's data.put + metadata.put pair, which together fire the
		// `/artifacts/version-set` wire call. The corpus return value
		// reports the local-generated version (it has no protocol to learn
		// the server's), so consumers that need the remote version_set_id
		// should use `upload_version_set` directly.
		const backend = await selectCorpusBackend({
			mode: "cloudflare-http",
			pipelines_url: h.url,
			pipelines_token: VALID_TOKEN,
		});
		const store = version_set_store(backend);
		const put = await store.put(valid_manifest({ package: "selector-pkg" }));
		expect(put.ok).toBe(true);

		// The server's backend should have a version-sets snapshot for
		// "selector-pkg". The corpus version_set_store keys metadata under
		// `version-sets` + the package tag; iterate the index to confirm.
		const server_store = version_set_store(h.backend);
		const found_packages: string[] = [];
		for await (const meta of server_store.store.list()) {
			const pkg_tag = meta.tags?.find((t) => t.startsWith("pkg:"))?.slice(4);
			if (pkg_tag !== undefined) found_packages.push(pkg_tag);
		}
		expect(found_packages).toContain("selector-pkg");
	});
});
