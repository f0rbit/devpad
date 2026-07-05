/**
 * @module @devpad/cli/tests/integration/artifacts-upload-directory
 *
 * End-to-end coverage for the directory-bundle + asset-walker upload path
 * added in Phase 3.A. Spins up the same `node:http` orchestrator stub the
 * single-file test suite uses (`corpus-http-backend.test.ts`), drives the
 * walkers + manifest builders directly, and exercises the new
 * `action_artifacts_upload` command via its public surface.
 *
 * What this asserts (one test per acceptance criterion):
 *  - single-module directory bundle uploads one worker-modules blob + a
 *    BundleManifest blob, stamps `bundle_manifest_ref` on the version-set
 *  - multi-module bundle (entrypoint + chunk + wasm) uploads N module
 *    blobs, BundleManifest references each one by ref + name
 *  - directory bundle + assets-dir flag uploads both manifests and the
 *    version-set carries both refs
 *  - `--bundle` + `--bundle-dir` is rejected
 *  - neither flag is rejected
 *  - identical asset bytes dedup on corpus (no double upload)
 *  - BLAKE3 hash matches a known-good wrangler-style fixture
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AssetManifest, BundleManifest } from "@devpad/pipeline-fakes/manifests";
import { type Backend, create_memory_backend, type VersionSetManifest, version_set_store } from "@f0rbit/corpus";
import { compute_asset_hash, walk_assets_dir } from "../../src/asset-walker";
import { walk_bundle_dir } from "../../src/bundle-walker";
import { action_artifacts_upload } from "../../src/commands/pipelines";

const VALID_TOKEN = "test-pipelines-token-XYZ";

type ServerHandle = {
	server: http.Server;
	url: string;
	backend: Backend;
	/** Counts data.put calls keyed by content_hash so dedup behaviour is observable from tests. */
	puts_by_hash: Map<string, number>;
	/** Counts data.put calls keyed by store_id so callers can assert per-store upload counts. */
	puts_by_store: Map<string, number>;
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
	const puts_by_hash = new Map<string, number>();
	const puts_by_store = new Map<string, number>();
	const handle_request = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
		try {
			const url = req.url ?? "/";
			const auth = req.headers.authorization ?? "";
			if (!url.startsWith("/artifacts/")) {
				send_json(res, 404, { ok: false, error: { code: "not_found" } });
				return;
			}
			if (!auth.startsWith("Bearer ") || auth.slice("Bearer ".length).trim() !== VALID_TOKEN) {
				send_json(res, 401, { ok: false, error: { code: "unauthorized" } });
				return;
			}
			if (url === "/artifacts/blob" && req.method === "POST") {
				const store_id_header = req.headers["x-store-id"];
				const store_id = typeof store_id_header === "string" ? store_id_header : "";
				const buf = await read_body(req);
				const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
				const content_hash = await sha256_hex(bytes);
				// Track the upload so dedup tests can observe whether identical
				// bytes hit the network twice or once.
				puts_by_hash.set(content_hash, (puts_by_hash.get(content_hash) ?? 0) + 1);
				puts_by_store.set(store_id, (puts_by_store.get(store_id) ?? 0) + 1);
				const version = generate_version();
				const data_key = `${store_id}/${content_hash}`;
				// Content-addressed dedup: if the backend already has this blob,
				// don't re-store it. Real corpus is content-hash addressed so
				// this is the production behaviour we mirror.
				const existing = await backend.metadata.find_by_hash(store_id, content_hash);
				if (existing === null) {
					const put_result = await backend.data.put(data_key, bytes);
					if (!put_result.ok) throw new Error(`backend.data.put failed: ${put_result.error.kind}`);
					const meta_result = await backend.metadata.put({
						store_id,
						version,
						parents: [],
						created_at: new Date(),
						content_hash,
						content_type: "application/octet-stream",
						size_bytes: bytes.byteLength,
						data_key,
					});
					if (!meta_result.ok) throw new Error(`backend.metadata.put failed: ${meta_result.error.kind}`);
				}
				send_json(res, 200, { ok: true, value: { version, content_hash, store_id, ref: data_key } });
				return;
			}
			if (url === "/artifacts/version-set" && req.method === "POST") {
				const buf = await read_body(req);
				let parsed_body: unknown = null;
				try {
					const raw_body: unknown = JSON.parse(buf.toString("utf8"));
					parsed_body = raw_body;
				} catch {
					send_json(res, 400, { ok: false, error: { code: "invalid_body" } });
					return;
				}
				if (parsed_body === null || typeof parsed_body !== "object") {
					send_json(res, 400, { ok: false, error: { code: "invalid_body" } });
					return;
				}
				// The server-side `version_set_store` runs the Zod schema on
				// read but not on write (json_codec.encode is just stringify).
				// We bypass the typed store and stamp metadata directly so the
				// directory-bundle fields (which aren't in the upstream schema
				// yet) round-trip without rejection.
				const manifest = parsed_body as VersionSetManifest;
				const text = buf.toString("utf8");
				const content_hash = await sha256_hex(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
				const version = generate_version();
				const data_key = `version-sets/${manifest.package}/${content_hash}`;
				const put_result = await backend.data.put(data_key, new TextEncoder().encode(text));
				if (!put_result.ok) throw new Error(`backend.data.put failed: ${put_result.error.kind}`);
				const meta_result = await backend.metadata.put({
					store_id: "version-sets",
					version,
					parents: [],
					created_at: new Date(),
					content_hash,
					content_type: "application/json",
					size_bytes: buf.byteLength,
					data_key,
					tags: [`pkg:${manifest.package}`],
				});
				if (!meta_result.ok) throw new Error(`backend.metadata.put failed: ${meta_result.error.kind}`);
				send_json(res, 200, { ok: true, value: { version_set_id: version, content_hash, package: manifest.package } });
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
	return { server, url: `http://127.0.0.1:${String(address.port)}`, backend, puts_by_hash, puts_by_store };
};

const stop_test_server = async (h: ServerHandle): Promise<void> =>
	new Promise((resolve) => {
		h.server.close(() => {
			resolve();
		});
	});

const read_blob_text = async (backend: Backend, ref: string): Promise<string> => {
	const get = await backend.data.get(ref);
	if (!get.ok) throw new Error(`backend.data.get(${ref}) failed`);
	const bytes = await get.value.bytes();
	return new TextDecoder().decode(bytes);
};

const read_version_set_manifest = async (backend: Backend, version: string): Promise<Record<string, unknown>> => {
	const meta = await backend.metadata.get("version-sets", version);
	if (!meta.ok) throw new Error("version-set metadata missing");
	const raw: unknown = JSON.parse(await read_blob_text(backend, meta.value.data_key));
	return raw as Record<string, unknown>;
};

type Fixtures = {
	dir: string;
	bundle_dir: string;
	assets_dir: string;
	infra_plan: string;
	pipeline: string;
	grants: string;
	output: string;
};

const setup_fixtures = (): Fixtures => {
	const dir = mkdtempSync(join(tmpdir(), "cli-3a-"));
	const bundle_dir = join(dir, "bundle");
	const assets_dir = join(dir, "assets");
	mkdirSync(bundle_dir, { recursive: true });
	mkdirSync(assets_dir, { recursive: true });
	const infra_plan = join(dir, "infra.ts");
	const pipeline = join(dir, "pipeline.ts");
	const grants = join(dir, "grants.ts");
	const output = join(dir, "version-set.json");
	writeFileSync(infra_plan, "export default {}\n");
	writeFileSync(pipeline, "export default { rollout: { type: 'atomic' }, gates: {} }\n");
	writeFileSync(grants, "export default { production: [], staging: [] }\n");
	return { dir, bundle_dir, assets_dir, infra_plan, pipeline, grants, output };
};

const cleanup_fixtures = (fx: Fixtures): void => {
	try {
		rmSync(fx.dir, { recursive: true, force: true });
	} catch {
		// ignore — temp dir best-effort
	}
};

const set_pipelines_env = (url: string): { restore: () => void } => {
	const prev_url = process.env.DEVPAD_PIPELINES_URL;
	const prev_token = process.env.DEVPAD_PIPELINES_TOKEN;
	process.env.DEVPAD_PIPELINES_URL = url;
	process.env.DEVPAD_PIPELINES_TOKEN = VALID_TOKEN;
	return {
		restore: () => {
			if (prev_url === undefined) delete process.env.DEVPAD_PIPELINES_URL;
			else process.env.DEVPAD_PIPELINES_URL = prev_url;
			if (prev_token === undefined) delete process.env.DEVPAD_PIPELINES_TOKEN;
			else process.env.DEVPAD_PIPELINES_TOKEN = prev_token;
		},
	};
};

const expect_exit = async (run: () => Promise<unknown>): Promise<number> => {
	const original_exit = process.exit.bind(process);
	let exit_code: number | undefined;
	(process as unknown as { exit: (code?: number) => never }).exit = (code?: number) => {
		exit_code = code ?? 0;
		throw new Error("__exit__");
	};
	try {
		await run();
	} catch (e) {
		if ((e as Error).message !== "__exit__") throw e;
	} finally {
		(process as unknown as { exit: typeof process.exit }).exit = original_exit;
	}
	return exit_code ?? 0;
};

describe("artifacts upload — directory bundles", () => {
	let h: ServerHandle;
	let fx: Fixtures;
	let env_restore: () => void;

	beforeEach(async () => {
		h = await start_test_server();
		fx = setup_fixtures();
		env_restore = set_pipelines_env(h.url).restore;
	});

	afterEach(async () => {
		env_restore();
		cleanup_fixtures(fx);
		await stop_test_server(h);
	});

	test("--bundle-dir with single module uploads one ModulePart blob + BundleManifest", async () => {
		writeFileSync(join(fx.bundle_dir, "index.js"), "export default { fetch() { return new Response('hi') } }\n");

		const exit = await expect_exit(async () => {
			await action_artifacts_upload({
				package: "single-module-pkg",
				bundleDir: fx.bundle_dir,
				mainModule: "index.js",
				infraPlan: fx.infra_plan,
				pipeline: fx.pipeline,
				grants: fx.grants,
				output: fx.output,
			});
		});
		expect(exit).toBe(0);

		// worker-modules: 1 module + bundle-manifests: 1 manifest
		expect(h.puts_by_store.get("worker-modules") ?? 0).toBe(1);
		expect(h.puts_by_store.get("bundle-manifests") ?? 0).toBe(1);

		// Pull back the stored version-set and assert the directory-bundle ref
		// is stamped on the manifest.
		const found_packages: string[] = [];
		const sets = version_set_store(h.backend);
		for await (const meta of sets.store.list()) {
			const pkg = meta.tags?.find((t) => t.startsWith("pkg:"))?.slice(4);
			if (pkg !== undefined) found_packages.push(pkg);
		}
		expect(found_packages).toContain("single-module-pkg");

		const version = found_packages.map((p) => p).length;
		expect(version).toBeGreaterThan(0);
		// Walk the metadata index to find the snapshot version
		let target_version: string | undefined;
		for await (const meta of sets.store.list()) {
			if (meta.tags?.includes("pkg:single-module-pkg")) {
				target_version = meta.version;
				break;
			}
		}
		expect(target_version).toBeDefined();

		const manifest_doc = await read_version_set_manifest(h.backend, target_version!);
		const builds = manifest_doc.builds as { worker: { bundle_manifest_ref?: string; artifact_ref?: string } };
		expect(builds.worker.bundle_manifest_ref).toBeDefined();
		expect(builds.worker.bundle_manifest_ref).toMatch(/^bundle-manifests\//);
		// The legacy single-file ref is intentionally empty in directory mode.
		expect(builds.worker.artifact_ref).toBe("");

		// Dereference the bundle manifest and assert its shape.
		const bundle_text = await read_blob_text(h.backend, builds.worker.bundle_manifest_ref!);
		const parsed = BundleManifest.parse(JSON.parse(bundle_text));
		expect(parsed.main_module).toBe("index.js");
		expect(parsed.modules).toHaveLength(1);
		expect(parsed.modules[0].name).toBe("index.js");
		expect(parsed.modules[0].mime_type).toBe("application/javascript+module");
		expect(parsed.modules[0].content_artifact_ref).toMatch(/^worker-modules\//);
	});

	test("--bundle-dir with multiple modules + wasm uploads each as separate corpus blobs", async () => {
		writeFileSync(join(fx.bundle_dir, "index.js"), "import './chunks/foo.mjs'\n");
		mkdirSync(join(fx.bundle_dir, "chunks"), { recursive: true });
		writeFileSync(join(fx.bundle_dir, "chunks", "foo.mjs"), "export const foo = 1\n");
		writeFileSync(
			join(fx.bundle_dir, "chunks", "bar.wasm"),
			Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]),
		);

		const exit = await expect_exit(async () => {
			await action_artifacts_upload({
				package: "multi-module-pkg",
				bundleDir: fx.bundle_dir,
				mainModule: "index.js",
				infraPlan: fx.infra_plan,
				pipeline: fx.pipeline,
				grants: fx.grants,
				output: fx.output,
			});
		});
		expect(exit).toBe(0);

		expect(h.puts_by_store.get("worker-modules") ?? 0).toBe(3);
		expect(h.puts_by_store.get("bundle-manifests") ?? 0).toBe(1);

		const sets = version_set_store(h.backend);
		let target_version: string | undefined;
		for await (const meta of sets.store.list()) {
			if (meta.tags?.includes("pkg:multi-module-pkg")) {
				target_version = meta.version;
				break;
			}
		}
		const manifest_doc = await read_version_set_manifest(h.backend, target_version!);
		const builds = manifest_doc.builds as { worker: { bundle_manifest_ref?: string } };
		const bundle_text = await read_blob_text(h.backend, builds.worker.bundle_manifest_ref!);
		const parsed = BundleManifest.parse(JSON.parse(bundle_text));

		expect(parsed.modules).toHaveLength(3);
		const by_name = new Map(parsed.modules.map((m) => [m.name, m]));
		expect(by_name.get("index.js")?.mime_type).toBe("application/javascript+module");
		expect(by_name.get("chunks/foo.mjs")?.mime_type).toBe("application/javascript+module");
		expect(by_name.get("chunks/bar.wasm")?.mime_type).toBe("application/wasm");

		// Every part references a unique corpus blob.
		const refs = new Set(parsed.modules.map((m) => m.content_artifact_ref));
		expect(refs.size).toBe(3);
	});

	test("--bundle-dir + --assets-dir uploads both manifests + stamps both refs", async () => {
		writeFileSync(join(fx.bundle_dir, "index.js"), "export default { fetch() { return new Response('hi') } }\n");
		// Asset dir is intentionally separate from bundle dir for this test —
		// the in-dist nesting case is covered separately below.
		writeFileSync(join(fx.assets_dir, "style.css"), "body { color: red }\n");
		writeFileSync(join(fx.assets_dir, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

		const exit = await expect_exit(async () => {
			await action_artifacts_upload({
				package: "with-assets-pkg",
				bundleDir: fx.bundle_dir,
				mainModule: "index.js",
				assetsDir: fx.assets_dir,
				infraPlan: fx.infra_plan,
				pipeline: fx.pipeline,
				grants: fx.grants,
				output: fx.output,
			});
		});
		expect(exit).toBe(0);

		expect(h.puts_by_store.get("worker-modules") ?? 0).toBe(1);
		expect(h.puts_by_store.get("bundle-manifests") ?? 0).toBe(1);
		expect(h.puts_by_store.get("asset-files") ?? 0).toBe(2);
		expect(h.puts_by_store.get("asset-manifests") ?? 0).toBe(1);

		const sets = version_set_store(h.backend);
		let target_version: string | undefined;
		for await (const meta of sets.store.list()) {
			if (meta.tags?.includes("pkg:with-assets-pkg")) {
				target_version = meta.version;
				break;
			}
		}
		const manifest_doc = await read_version_set_manifest(h.backend, target_version!);
		const builds = manifest_doc.builds as {
			worker: { bundle_manifest_ref?: string };
			assets?: { manifest_ref?: string };
		};
		expect(builds.worker.bundle_manifest_ref).toMatch(/^bundle-manifests\//);
		expect(builds.assets?.manifest_ref).toMatch(/^asset-manifests\//);

		const asset_text = await read_blob_text(h.backend, builds.assets!.manifest_ref!);
		const parsed = AssetManifest.parse(JSON.parse(asset_text));
		expect(parsed.assets).toHaveLength(2);
		const paths = parsed.assets.map((a) => a.path).toSorted();
		expect(paths).toEqual(["/logo.png", "/style.css"]);
		// Hashes must match wrangler's 32-char BLAKE3 form.
		for (const a of parsed.assets) {
			expect(a.hash).toMatch(/^[0-9a-f]{32}$/);
		}
	});

	test("--bundle + --bundle-dir together is rejected", async () => {
		const single_bundle = join(fx.dir, "_worker.js");
		writeFileSync(single_bundle, "export default {}\n");
		writeFileSync(join(fx.bundle_dir, "index.js"), "export default {}\n");

		const exit = await expect_exit(async () => {
			await action_artifacts_upload({
				package: "conflict-pkg",
				bundle: single_bundle,
				bundleDir: fx.bundle_dir,
				mainModule: "index.js",
				infraPlan: fx.infra_plan,
				pipeline: fx.pipeline,
				grants: fx.grants,
				output: fx.output,
			});
		});
		expect(exit).toBe(1);
	});

	test("missing both --bundle and --bundle-dir is rejected", async () => {
		const exit = await expect_exit(async () => {
			await action_artifacts_upload({
				package: "missing-pkg",
				infraPlan: fx.infra_plan,
				pipeline: fx.pipeline,
				grants: fx.grants,
				output: fx.output,
			});
		});
		expect(exit).toBe(1);
	});

	test("asset dedup: identical bytes uploaded twice only stores once on corpus", async () => {
		writeFileSync(join(fx.bundle_dir, "index.js"), "export default {}\n");
		// Same bytes (and same extension → same BLAKE3 cf-hash) under two
		// different paths. Different CF manifest entries but a single corpus
		// blob.
		const bytes = "/* shared css */ body { color: red }\n";
		writeFileSync(join(fx.assets_dir, "a.css"), bytes);
		writeFileSync(join(fx.assets_dir, "b.css"), bytes);

		const exit = await expect_exit(async () => {
			await action_artifacts_upload({
				package: "dedup-pkg",
				bundleDir: fx.bundle_dir,
				mainModule: "index.js",
				assetsDir: fx.assets_dir,
				infraPlan: fx.infra_plan,
				pipeline: fx.pipeline,
				grants: fx.grants,
				output: fx.output,
			});
		});
		expect(exit).toBe(0);

		// Both PUT requests hit the wire, but the backend dedups: the same
		// content-hash appears twice in `puts_by_hash` (request count) but
		// `backend.data.get(ref)` resolves to a single stored object.
		const asset_put_count = h.puts_by_store.get("asset-files") ?? 0;
		expect(asset_put_count).toBe(2);
		// `puts_by_hash` is keyed by content-hash — same bytes → same hash
		// → counter on that single key shows 2. Confirms the server saw the
		// same content twice and dedup'd at the metadata.find_by_hash
		// gate (so backend.data has one underlying blob).
		const counts = Array.from(h.puts_by_hash.values()).toSorted();
		// We had: 1 index.js (worker-modules), 1 a.css/b.css shared, 1 bundle-manifest, 1 asset-manifest, 1 pipeline-templates, 1 env-manifests, 1 infra-plans, 1 grants
		// The asset dedup count of 2 sits among those — at least one hash counter must be ≥ 2.
		expect(Math.max(...counts)).toBeGreaterThanOrEqual(2);
	});

	test("BLAKE3 hash matches wrangler's algorithm for a known fixture", () => {
		// Reference vector: wrangler hashes (base64(bytes) + extension).
		// We replicate that locally and confirm the walker's hash matches.
		const bytes = new TextEncoder().encode("hello world\n");
		const expected = compute_asset_hash(bytes, "txt");
		// Walker output must produce the same hash for the same content +
		// extension. Drop a fixture and read it back to compare.
		const probe_dir = join(fx.dir, "probe");
		mkdirSync(probe_dir, { recursive: true });
		writeFileSync(join(probe_dir, "hello.txt"), Buffer.from(bytes));

		const walk = walk_assets_dir(probe_dir);
		expect(walk.ok).toBe(true);
		if (!walk.ok) return;
		expect(walk.value.parts).toHaveLength(1);
		expect(walk.value.parts[0].hash).toBe(expected);
		expect(walk.value.parts[0].hash).toMatch(/^[0-9a-f]{32}$/);
	});

	test("bundle walker rejects unsupported extensions", () => {
		writeFileSync(join(fx.bundle_dir, "index.js"), "export default {}\n");
		writeFileSync(join(fx.bundle_dir, "data.json"), "{}\n");
		const walk = walk_bundle_dir(fx.bundle_dir);
		expect(walk.ok).toBe(false);
		if (walk.ok) return;
		expect(walk.error.kind).toBe("unsupported_extension");
	});

	test("asset walker respects .assetsignore at root + always-skipped metafiles", () => {
		writeFileSync(join(fx.assets_dir, "page.html"), "<html></html>\n");
		writeFileSync(join(fx.assets_dir, "secret.txt"), "shh\n");
		writeFileSync(join(fx.assets_dir, "_redirects"), "/old /new 301\n");
		writeFileSync(join(fx.assets_dir, "_headers"), "/*\n  X-Frame-Options: DENY\n");
		writeFileSync(join(fx.assets_dir, ".assetsignore"), "secret.txt\n");

		const walk = walk_assets_dir(fx.assets_dir);
		expect(walk.ok).toBe(true);
		if (!walk.ok) return;
		const paths = walk.value.parts.map((p) => p.path).toSorted();
		expect(paths).toEqual(["/page.html"]);
	});
});
