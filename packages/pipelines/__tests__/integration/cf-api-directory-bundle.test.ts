/**
 * @module pipelines/__tests__/integration/cf-api-directory-bundle
 *
 * Phase 2.A — directory-bundle Worker uploads + ASSETS-binding upload
 * sessions on the production `cf-api-provider`.
 *
 * The recorder peels apart the multipart body so the assertions can stay
 * on the `metadata` JSON part. The module / asset parts are checked
 * separately for content-type + bytes. The asset-upload-session POST is
 * captured as a JSON body (the provider sends `{ manifest: {...} }`),
 * and each subsequent per-bucket assets/upload POST is captured as a
 * multipart body keyed by hash.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import type { AssetUpload, ModuleUpload } from "@devpad/pipeline-fakes";
import { build_assets_manifest, make_cf_api_provider } from "../../src/providers/cf-api-provider";

type ParsedParts = Record<
	string,
	{ content_type: string | null; filename: string | null; text: string; bytes: Uint8Array }
>;

type RecordedRequest = {
	method: string;
	pathname: string;
	authorization: string | null;
	content_type: string | null;
	body: unknown;
	parts: ParsedParts | null;
};

type RouteHandler = (req: RecordedRequest) => { status?: number; body: unknown };

type RecorderHandle = {
	server: Server<unknown>;
	base_url: string;
	requests: RecordedRequest[];
	route(matcher: (req: RecordedRequest) => boolean, handler: RouteHandler): void;
};

const decode_text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

const find_subarray = (haystack: Uint8Array, needle: Uint8Array, from: number): number => {
	outer: for (let i = from; i <= haystack.length - needle.length; i++) {
		for (let j = 0; j < needle.length; j++) {
			if (haystack[i + j] !== needle[j]) continue outer;
		}
		return i;
	}
	return -1;
};

const parse_multipart_raw = (raw: Uint8Array, content_type: string): ParsedParts | null => {
	const match = /boundary=([^;]+)/.exec(content_type);
	if (match === null) return null;
	const boundary = match[1].replace(/^"|"$/g, "");
	const delimiter = new TextEncoder().encode(`--${boundary}`);
	const out: ParsedParts = {};

	let cursor = find_subarray(raw, delimiter, 0);
	while (cursor >= 0) {
		const after = cursor + delimiter.length;
		if (raw[after] === 0x2d && raw[after + 1] === 0x2d) break;
		const next = find_subarray(raw, delimiter, after + 1);
		if (next < 0) break;
		const part_start = after + 2;
		const part_end = next - 2;
		const part = raw.subarray(part_start, part_end);
		const header_end = find_subarray(part, new Uint8Array([0x0d, 0x0a, 0x0d, 0x0a]), 0);
		if (header_end >= 0) {
			const header_text = decode_text(part.subarray(0, header_end));
			const body_bytes = part.subarray(header_end + 4);
			const disposition = /Content-Disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]+)")?/i.exec(
				header_text,
			);
			const content_type_match = /Content-Type:\s*([^\r\n]+)/i.exec(header_text);
			const name = disposition?.[1] ?? "";
			const filename = disposition?.[2] ?? null;
			const part_content_type = content_type_match?.[1].trim() ?? null;
			out[name] = {
				content_type: part_content_type,
				filename,
				text: decode_text(body_bytes),
				bytes: new Uint8Array(body_bytes),
			};
		}
		cursor = next;
	}
	return out;
};

const default_handler: RouteHandler = () => ({
	body: { success: true, errors: [], messages: [], result: {} },
});

const start_recorder = (): RecorderHandle => {
	const requests: RecordedRequest[] = [];
	const routes: Array<{ matcher: (req: RecordedRequest) => boolean; handler: RouteHandler }> = [];

	const server = Bun.serve({
		port: 0,
		async fetch(req) {
			const url = new URL(req.url);
			const content_type = req.headers.get("content-type");
			let body: unknown = null;
			let parts: ParsedParts | null = null;
			if (content_type !== null && content_type.startsWith("multipart/form-data")) {
				const raw = new Uint8Array(await req.arrayBuffer());
				parts = parse_multipart_raw(raw, content_type);
			} else {
				const text = await req.text();
				body = text;
				if (text.length > 0) {
					try {
						body = JSON.parse(text);
					} catch {
						// leave as string
					}
				}
			}
			const record: RecordedRequest = {
				method: req.method,
				pathname: url.pathname,
				authorization: req.headers.get("authorization"),
				content_type,
				body,
				parts,
			};
			requests.push(record);
			const route = routes.find((r) => r.matcher(record));
			const handler = route?.handler ?? default_handler;
			const out = handler(record);
			return new Response(JSON.stringify(out.body), {
				status: out.status ?? 200,
				headers: { "content-type": "application/json" },
			});
		},
	});

	return {
		server,
		base_url: `http://localhost:${String(server.port)}/client/v4`,
		requests,
		route(matcher, handler) {
			routes.push({ matcher, handler });
		},
	};
};

const make_test_provider = (recorder: RecorderHandle) =>
	make_cf_api_provider({
		account_id: "acct_test",
		api_token: "tok_test",
		base_url: recorder.base_url,
	});

const make_modules = (): ModuleUpload[] => [
	{
		name: "index.js",
		mime_type: "application/javascript+module",
		content: new TextEncoder().encode("export { default } from './chunks/main.mjs';"),
	},
	{
		name: "chunks/main.mjs",
		mime_type: "application/javascript+module",
		content: new TextEncoder().encode("export default { fetch: () => new Response('hi') };"),
	},
	{
		name: "chunks/resvg.wasm",
		mime_type: "application/wasm",
		content: new Uint8Array([0x00, 0x61, 0x73, 0x6d]),
	},
];

const make_assets = (): AssetUpload[] => [
	{
		path: "/_astro/index.css",
		hash: "0123456789abcdef0123456789abcdef",
		size_bytes: 4,
		mime_type: "text/css",
		content: new TextEncoder().encode("body"),
	},
	{
		path: "/index.html",
		hash: "fedcba9876543210fedcba9876543210",
		size_bytes: 5,
		mime_type: "text/html",
		content: new TextEncoder().encode("<html"),
	},
];

describe("cf-api-provider — directory_bundle uploads", () => {
	let recorder: RecorderHandle;

	beforeEach(() => {
		recorder = start_recorder();
	});

	afterEach(async () => {
		await recorder.server.stop(true);
	});

	test("posts multipart with metadata + one part per module (no assets)", async () => {
		recorder.route(
			(r) => r.pathname.endsWith("/versions"),
			() => ({
				body: {
					success: true,
					errors: [],
					messages: [],
					result: { id: "ver_dir", number: 7, metadata: { created_on: "2026-05-18T00:00:00Z" } },
				},
			}),
		);
		const provider = make_test_provider(recorder);

		const modules = make_modules();
		const result = await provider.versions.upload({
			kind: "directory_bundle",
			script_name: "astro-app",
			annotations: { "workers/tag": "vs_v1" },
			modules,
			main_module: "index.js",
			compatibility_date: "2026-05-01",
			compatibility_flags: ["nodejs_compat"],
		});
		expect(result.ok).toBe(true);

		expect(recorder.requests).toHaveLength(1);
		const req = recorder.requests[0];
		expect(req.method).toBe("POST");
		expect(req.pathname).toBe("/client/v4/accounts/acct_test/workers/scripts/astro-app/versions");
		expect(req.authorization).toBe("Bearer tok_test");
		expect(req.parts).not.toBeNull();

		const parts = req.parts!;
		expect(parts.metadata).toBeDefined();
		const metadata = JSON.parse(parts.metadata.text) as {
			main_module: string;
			compatibility_date: string;
			compatibility_flags: string[];
			annotations: Record<string, string>;
			assets?: unknown;
		};
		expect(metadata.main_module).toBe("index.js");
		expect(metadata.compatibility_date).toBe("2026-05-01");
		expect(metadata.compatibility_flags).toEqual(["nodejs_compat"]);
		expect(metadata.annotations).toEqual({ "workers/tag": "vs_v1" });
		expect(metadata.assets).toBeUndefined();

		// Every module name appears as its own multipart part with the right MIME.
		expect(parts["index.js"]).toBeDefined();
		expect(parts["index.js"].content_type).toBe("application/javascript+module");
		expect(parts["chunks/main.mjs"]).toBeDefined();
		expect(parts["chunks/main.mjs"].content_type).toBe("application/javascript+module");
		expect(parts["chunks/resvg.wasm"]).toBeDefined();
		expect(parts["chunks/resvg.wasm"].content_type).toBe("application/wasm");
		expect(parts["chunks/resvg.wasm"].bytes.length).toBe(4);
	});

	test("opens an assets-upload session BEFORE the versions upload, then stamps the jwt onto metadata.assets", async () => {
		recorder.route(
			(r) => r.pathname.endsWith("/assets-upload-session"),
			() => ({
				body: {
					success: true,
					errors: [],
					messages: [],
					result: {
						jwt: "session-jwt-xyz",
						buckets: [["0123456789abcdef0123456789abcdef", "fedcba9876543210fedcba9876543210"]],
					},
				},
			}),
		);
		recorder.route(
			(r) => r.pathname.endsWith("/assets/upload"),
			() => ({ body: { success: true, errors: [], messages: [], result: {} } }),
		);
		recorder.route(
			(r) => r.pathname.endsWith("/versions"),
			() => ({
				body: {
					success: true,
					errors: [],
					messages: [],
					result: { id: "ver_dir_assets", number: 8, metadata: { created_on: "2026-05-18T00:00:00Z" } },
				},
			}),
		);
		const provider = make_test_provider(recorder);

		const result = await provider.versions.upload({
			kind: "directory_bundle",
			script_name: "astro-app",
			modules: make_modules(),
			main_module: "index.js",
			compatibility_date: "2026-05-01",
			assets: {
				assets: make_assets(),
				config: { html_handling: "auto-trailing-slash", not_found_handling: "single-page-application" },
			},
		});
		expect(result.ok).toBe(true);

		// Three requests: session open, per-bucket upload, then versions upload.
		expect(recorder.requests).toHaveLength(3);

		const [session_req, bucket_req, versions_req] = recorder.requests;
		expect(session_req.method).toBe("POST");
		expect(session_req.pathname).toBe("/client/v4/accounts/acct_test/workers/scripts/astro-app/assets-upload-session");
		expect(session_req.authorization).toBe("Bearer tok_test");
		const session_body = session_req.body as { manifest: Record<string, { hash: string; size: number }> };
		expect(session_body.manifest).toEqual({
			"/_astro/index.css": { hash: "0123456789abcdef0123456789abcdef", size: 4 },
			"/index.html": { hash: "fedcba9876543210fedcba9876543210", size: 5 },
		});

		expect(bucket_req.method).toBe("POST");
		expect(bucket_req.pathname).toBe("/client/v4/accounts/acct_test/workers/assets/upload");
		// CRITICAL: bucket upload uses the session jwt, NOT the cf api token.
		expect(bucket_req.authorization).toBe("Bearer session-jwt-xyz");
		expect(bucket_req.parts).not.toBeNull();
		// Each part is keyed by hash; body is base64(asset.content).
		const css_part = bucket_req.parts!["0123456789abcdef0123456789abcdef"];
		expect(css_part).toBeDefined();
		// Bun's FormData appends `;charset=utf-8` to text MIME types; assert
		// the prefix only.
		expect(css_part.content_type ?? "").toMatch(/^text\/css\b/);
		expect(css_part.text).toBe(Buffer.from("body").toString("base64"));
		const html_part = bucket_req.parts!["fedcba9876543210fedcba9876543210"];
		expect(html_part).toBeDefined();
		expect(html_part.content_type ?? "").toMatch(/^text\/html\b/);
		expect(html_part.text).toBe(Buffer.from("<html").toString("base64"));

		// And finally the versions upload carries metadata.assets.jwt + config.
		expect(versions_req.pathname).toBe("/client/v4/accounts/acct_test/workers/scripts/astro-app/versions");
		expect(versions_req.parts!.metadata).toBeDefined();
		const metadata = JSON.parse(versions_req.parts!.metadata.text) as {
			assets?: { jwt: string; config: Record<string, unknown> };
		};
		expect(metadata.assets).toBeDefined();
		expect(metadata.assets!.jwt).toBe("session-jwt-xyz");
		expect(metadata.assets!.config).toEqual({
			html_handling: "auto-trailing-slash",
			not_found_handling: "single-page-application",
		});
	});

	test("rejects directory_bundle whose main_module is not in modules", async () => {
		const provider = make_test_provider(recorder);
		const result = await provider.versions.upload({
			kind: "directory_bundle",
			script_name: "astro-app",
			modules: make_modules(),
			main_module: "missing.js",
			compatibility_date: "2026-05-01",
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code).toBe("validation");
		// No requests should have been issued — validation happens client-side.
		expect(recorder.requests).toHaveLength(0);
	});

	test("rejects assets with a non-32-char hash without opening a session", async () => {
		const provider = make_test_provider(recorder);
		const result = await provider.versions.upload({
			kind: "directory_bundle",
			script_name: "astro-app",
			modules: make_modules(),
			main_module: "index.js",
			compatibility_date: "2026-05-01",
			assets: {
				assets: [
					{
						path: "/foo.css",
						hash: "shorthash",
						size_bytes: 3,
						mime_type: "text/css",
						content: new TextEncoder().encode("foo"),
					},
				],
			},
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code).toBe("validation");
		expect(recorder.requests).toHaveLength(0);
	});

	test("surfaces an assets/upload failure as assets_upload_failed without uploading the version", async () => {
		recorder.route(
			(r) => r.pathname.endsWith("/assets-upload-session"),
			() => ({
				body: {
					success: true,
					errors: [],
					messages: [],
					result: { jwt: "session-jwt", buckets: [["0123456789abcdef0123456789abcdef"]] },
				},
			}),
		);
		recorder.route(
			(r) => r.pathname.endsWith("/assets/upload"),
			() => ({
				status: 500,
				body: { success: false, errors: [{ code: 500, message: "boom" }], messages: [], result: null },
			}),
		);
		const provider = make_test_provider(recorder);
		const result = await provider.versions.upload({
			kind: "directory_bundle",
			script_name: "astro-app",
			modules: make_modules(),
			main_module: "index.js",
			compatibility_date: "2026-05-01",
			assets: {
				assets: [make_assets()[0]],
			},
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code).toBe("assets_upload_failed");
		// The session POST + the failed bucket POST were captured, but no /versions POST happened.
		const paths = recorder.requests.map((r) => r.pathname);
		expect(paths.some((p) => p.endsWith("/versions"))).toBe(false);
	});

	test("build_assets_manifest produces the wire-shape session manifest", () => {
		const assets = make_assets();
		const manifest = build_assets_manifest(assets);
		expect(manifest).toEqual({
			"/_astro/index.css": { hash: "0123456789abcdef0123456789abcdef", size: 4 },
			"/index.html": { hash: "fedcba9876543210fedcba9876543210", size: 5 },
		});
	});
});
