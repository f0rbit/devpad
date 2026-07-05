import { describe, expect, test } from "bun:test";
import { AssetManifest, AssetPart, BundleManifest, ModulePart } from "../src/manifests.ts";

describe("BundleManifest", () => {
	test("round-trips a directory-bundle worker through parse + JSON", () => {
		const input = {
			main_module: "index.js",
			modules: [
				{
					name: "index.js",
					mime_type: "application/javascript+module",
					content_artifact_ref: "worker-modules/abc123",
					size_bytes: 4096,
				},
				{
					name: "chunks/Experience_C-JXuqRe.mjs",
					mime_type: "application/javascript+module",
					content_artifact_ref: "worker-modules/def456",
					size_bytes: 2048,
				},
				{
					name: "RESVG_WASM",
					mime_type: "application/wasm",
					content_artifact_ref: "worker-modules/ghi789",
					size_bytes: 102_400,
				},
			],
			compatibility_date: "2025-05-01",
			compatibility_flags: ["nodejs_compat"],
		};

		const parsed = BundleManifest.parse(input);
		const reparsed = BundleManifest.parse(JSON.parse(JSON.stringify(parsed)));

		expect(reparsed).toEqual(parsed);
		expect(reparsed.modules).toHaveLength(3);
		expect(reparsed.main_module).toBe("index.js");
	});

	test("defaults compatibility_flags to empty array when omitted", () => {
		const parsed = BundleManifest.parse({
			main_module: "index.js",
			modules: [],
			compatibility_date: "2025-05-01",
		});
		expect(parsed.compatibility_flags).toEqual([]);
	});

	test("accepts an empty modules array (degenerate bundle)", () => {
		const parsed = BundleManifest.parse({
			main_module: "index.js",
			modules: [],
			compatibility_date: "2025-05-01",
		});
		expect(parsed.modules).toEqual([]);
	});
});

describe("ModulePart", () => {
	test("rejects an unknown mime_type", () => {
		const result = ModulePart.safeParse({
			name: "index.js",
			mime_type: "application/x-not-a-real-type",
			content_artifact_ref: "worker-modules/abc",
			size_bytes: 1,
		});
		expect(result.success).toBe(false);
	});

	test("accepts each known mime_type", () => {
		const types = [
			"application/javascript+module",
			"application/javascript",
			"application/wasm",
			"application/octet-stream",
			"text/plain",
			"text/x-python",
			"text/x-python-requirement",
		] as const;
		for (const t of types) {
			const result = ModulePart.safeParse({
				name: "x",
				mime_type: t,
				content_artifact_ref: "worker-modules/abc",
				size_bytes: 0,
			});
			expect(result.success).toBe(true);
		}
	});

	test("rejects negative size_bytes", () => {
		const result = ModulePart.safeParse({
			name: "index.js",
			mime_type: "application/javascript+module",
			content_artifact_ref: "worker-modules/abc",
			size_bytes: -1,
		});
		expect(result.success).toBe(false);
	});
});

describe("AssetManifest", () => {
	test("round-trips an asset manifest through parse + JSON", () => {
		const input = {
			assets: [
				{
					path: "/_astro/index.B2w6jFLc.css",
					hash: "abcd1234ef0123456789abcdef012345",
					size_bytes: 4096,
					mime_type: "text/css",
					content_artifact_ref: "asset-files/aaa",
				},
				{
					path: "/photos/foo.png",
					hash: "0123456789abcdef0123456789abcdef",
					size_bytes: 102_400,
					mime_type: "image/png",
					content_artifact_ref: "asset-files/bbb",
				},
			],
			config: {
				html_handling: "auto-trailing-slash",
				not_found_handling: "single-page-application",
				run_worker_first: false,
			},
		};

		const parsed = AssetManifest.parse(input);
		const reparsed = AssetManifest.parse(JSON.parse(JSON.stringify(parsed)));

		expect(reparsed).toEqual(parsed);
		expect(reparsed.assets).toHaveLength(2);
	});

	test("defaults config to {} when omitted", () => {
		const parsed = AssetManifest.parse({ assets: [] });
		expect(parsed.config).toEqual({});
	});

	test("accepts an empty assets array", () => {
		const parsed = AssetManifest.parse({ assets: [] });
		expect(parsed.assets).toEqual([]);
	});
});

describe("AssetPart", () => {
	test("rejects a hash shorter than 32 chars", () => {
		const result = AssetPart.safeParse({
			path: "/foo.css",
			hash: "abc",
			size_bytes: 1,
			mime_type: "text/css",
			content_artifact_ref: "asset-files/x",
		});
		expect(result.success).toBe(false);
	});

	test("rejects a hash longer than 32 chars", () => {
		const result = AssetPart.safeParse({
			path: "/foo.css",
			hash: "abcd1234ef0123456789abcdef0123456789",
			size_bytes: 1,
			mime_type: "text/css",
			content_artifact_ref: "asset-files/x",
		});
		expect(result.success).toBe(false);
	});

	test("accepts a hash of exactly 32 chars", () => {
		const result = AssetPart.safeParse({
			path: "/foo.css",
			hash: "abcd1234ef0123456789abcdef012345",
			size_bytes: 1,
			mime_type: "text/css",
			content_artifact_ref: "asset-files/x",
		});
		expect(result.success).toBe(true);
	});

	test("rejects negative size_bytes", () => {
		const result = AssetPart.safeParse({
			path: "/foo.css",
			hash: "abcd1234ef0123456789abcdef012345",
			size_bytes: -1,
			mime_type: "text/css",
			content_artifact_ref: "asset-files/x",
		});
		expect(result.success).toBe(false);
	});
});
