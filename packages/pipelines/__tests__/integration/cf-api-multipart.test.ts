/**
 * @module pipelines/__tests__/integration/cf-api-multipart
 *
 * Phase 6 — focused tests on the multipart upload shape `versions.upload`
 * must emit. The dedicated test asserts:
 *
 * - `Content-Type: multipart/form-data; boundary=...` on the outbound request
 * - a `metadata` part with valid JSON
 * - a script part whose form-field name matches `main_module` and whose
 *   `Content-Type` is `application/javascript+module`
 * - the multipart envelope is correctly delimited (parsed back from raw bytes)
 *
 * The companion `cf-api-provider-vars.test.ts` covers the variable /
 * binding semantics; this file pins the wire shape.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { make_cf_api_provider } from "../../src/providers/cf-api-provider";

type Captured = {
	method: string;
	pathname: string;
	content_type: string | null;
	raw: Uint8Array;
};

type Recorder = {
	server: Server;
	base_url: string;
	captured: Captured[];
};

const start_recorder = (): Recorder => {
	const captured: Captured[] = [];
	const server = Bun.serve({
		port: 0,
		async fetch(req) {
			const url = new URL(req.url);
			const raw = new Uint8Array(await req.arrayBuffer());
			captured.push({
				method: req.method,
				pathname: url.pathname,
				content_type: req.headers.get("content-type"),
				raw,
			});
			return new Response(
				JSON.stringify({
					success: true,
					errors: [],
					messages: [],
					result: { id: "ver_test", number: 1, metadata: { created_on: "2026-05-17T00:00:00Z" } },
				}),
				{ headers: { "content-type": "application/json" } },
			);
		},
	});
	return { server, base_url: `http://localhost:${server.port}/client/v4`, captured };
};

describe("cf-api-provider — multipart wire format", () => {
	let recorder: Recorder;

	beforeEach(() => {
		recorder = start_recorder();
	});

	afterEach(() => {
		recorder.server.stop(true);
	});

	test("posts multipart/form-data with metadata + script parts", async () => {
		const provider = make_cf_api_provider({
			account_id: "acct_test",
			api_token: "tok_test",
			base_url: recorder.base_url,
		});

		const bundle = new TextEncoder().encode("export default { fetch: () => new Response('hi') };");
		const result = await provider.versions.upload({
			kind: "single_file",
			script_name: "demo-worker",
			bundle,
			annotations: { version_set_id: "vs_42" },
		});
		expect(result.ok).toBe(true);

		expect(recorder.captured).toHaveLength(1);
		const cap = recorder.captured[0];
		expect(cap.method).toBe("POST");
		expect(cap.pathname).toBe("/client/v4/accounts/acct_test/workers/scripts/demo-worker/versions");
		expect(cap.content_type ?? "").toMatch(/^multipart\/form-data;\s*boundary=/);

		const body_text = new TextDecoder().decode(cap.raw);
		// Boundary marker appears at least 2x (open) + 1x (close).
		const boundary_match = /boundary=([^;\s]+)/.exec(cap.content_type ?? "");
		expect(boundary_match).not.toBeNull();
		const boundary = boundary_match![1];
		const opens = body_text.split(`--${boundary}`).length - 1;
		// Expect: 2 part-delimiters + 1 closing `--boundary--` = 3 occurrences of `--boundary`.
		expect(opens).toBeGreaterThanOrEqual(3);
		expect(body_text.endsWith(`--${boundary}--\r\n`) || body_text.endsWith(`--${boundary}--`)).toBe(true);

		expect(body_text).toContain('Content-Disposition: form-data; name="metadata"');
		expect(body_text).toContain('Content-Disposition: form-data; name="index.js"; filename="index.js"');
		expect(body_text).toContain("application/javascript+module");
	});

	test("uses a custom main_module name when supplied", async () => {
		const provider = make_cf_api_provider({
			account_id: "acct_test",
			api_token: "tok_test",
			base_url: recorder.base_url,
		});

		const bundle = new TextEncoder().encode("export default {}");
		await provider.versions.upload({
			kind: "single_file",
			script_name: "demo",
			bundle,
			main_module: "worker.mjs",
		});

		const body_text = new TextDecoder().decode(recorder.captured[0].raw);
		expect(body_text).toContain('name="worker.mjs"; filename="worker.mjs"');
		const metadata_match = /name="metadata"[\s\S]*?\r\n\r\n(\{[\s\S]*?\})\r\n/.exec(body_text);
		expect(metadata_match).not.toBeNull();
		const metadata = JSON.parse(metadata_match![1]) as { main_module: string };
		expect(metadata.main_module).toBe("worker.mjs");
	});
});
