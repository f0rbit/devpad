/**
 * @module pipelines/__tests__/integration/cf-api-provider-vars
 *
 * Task 5.C — verify the production CF REST client forwards the
 * caller-identity trio as `metadata.bindings` on the upload request, and
 * decodes them back on `versions.list`.
 *
 * Phase 6 — uploads are now `multipart/form-data` (the only shape CF
 * accepts). The recorder peels apart the multipart body so the
 * assertions can stay on the `metadata` JSON part. The script part is
 * checked separately for content-type + bytes.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import type { WorkerVar } from "@devpad/pipeline-fakes";
import { make_cf_api_provider } from "../../src/providers/cf-api-provider";

type RecordedRequest = {
	method: string;
	pathname: string;
	authorization: string | null;
	content_type: string | null;
	/** Parsed JSON body for non-multipart requests, else `null`. */
	body: unknown;
	/** Parsed multipart parts keyed by form-field name, when the body was multipart. */
	parts: Record<
		string,
		{ content_type: string | null; filename: string | null; text: string; bytes: Uint8Array }
	> | null;
};

type RecorderHandle = {
	server: Server<unknown>;
	base_url: string;
	requests: RecordedRequest[];
	next_response: (handler: (req: RecordedRequest) => unknown) => void;
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

/**
 * Minimal multipart/form-data parser. Bun's `Request.formData()`
 * rewrites the per-part `Content-Type` (drops it on string-shaped Blobs
 * and rewrites `application/javascript+module` to
 * `text/javascript;charset=utf-8`), which destroys the on-the-wire shape
 * we actually need to assert. Parsing the raw body bytes preserves it.
 */
const parse_multipart_raw = (raw: Uint8Array, content_type: string): RecordedRequest["parts"] => {
	const match = /boundary=([^;]+)/.exec(content_type);
	if (match === null) return null;
	const boundary = match[1].replace(/^"|"$/g, "");
	const delimiter = new TextEncoder().encode(`--${boundary}`);
	const out: NonNullable<RecordedRequest["parts"]> = {};

	let cursor = find_subarray(raw, delimiter, 0);
	while (cursor >= 0) {
		const after = cursor + delimiter.length;
		// `--boundary--` marker terminates the body.
		if (raw[after] === 0x2d && raw[after + 1] === 0x2d) break;
		const next = find_subarray(raw, delimiter, after + 1);
		if (next < 0) break;
		const part_start = after + 2; // skip CRLF following the boundary
		const part_end = next - 2; // strip CRLF preceding the next boundary
		const part = raw.subarray(part_start, part_end);
		// Headers are CRLF-separated and terminated by a blank CRLF.
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

const default_responder = (): unknown => ({
	success: true,
	errors: [],
	messages: [],
	result: {},
});

const start_recorder = (): RecorderHandle => {
	const requests: RecordedRequest[] = [];
	let responder: (req: RecordedRequest) => unknown = default_responder;

	const server = Bun.serve({
		port: 0,
		async fetch(req) {
			const url = new URL(req.url);
			const content_type = req.headers.get("content-type");
			let body: unknown = null;
			let parts: RecordedRequest["parts"] = null;
			if (content_type !== null && content_type.startsWith("multipart/form-data")) {
				const raw = new Uint8Array(await req.arrayBuffer());
				parts = parse_multipart_raw(raw, content_type);
			} else {
				const text = await req.text();
				body = text;
				if (text.length > 0) {
					try {
						const raw_body: unknown = JSON.parse(text);
						body = raw_body;
					} catch {
						/* leave as string */
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
			const payload = responder(record);
			return new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } });
		},
	});

	return {
		server,
		base_url: `http://localhost:${String(server.port)}/client/v4`,
		requests,
		next_response: (handler) => {
			responder = handler;
		},
	};
};

const make_test_provider = (recorder: RecorderHandle) =>
	make_cf_api_provider({
		account_id: "acct_test",
		api_token: "tok_test",
		base_url: recorder.base_url,
	});

describe("cf-api-provider — caller-identity vars", () => {
	let recorder: RecorderHandle;

	beforeEach(() => {
		recorder = start_recorder();
	});

	afterEach(async () => {
		await recorder.server.stop(true);
	});

	test("versions.upload posts multipart with metadata.bindings carrying the plain_text trio", async () => {
		recorder.next_response(() => ({
			success: true,
			errors: [],
			messages: [],
			result: {
				id: "ver_abc",
				number: 42,
				metadata: { created_on: "2026-05-16T00:00:00Z" },
				annotations: { version_set_id: "vs_v1" },
			},
		}));
		const provider = make_test_provider(recorder);

		const vars: WorkerVar[] = [
			{ type: "plain_text", name: "CALLER_PACKAGE", text: "anthropic-search" },
			{ type: "plain_text", name: "CALLER_ENV", text: "production" },
			{ type: "plain_text", name: "CALLER_VERSION_SET_ID", text: "vs_v1" },
		];

		const bundle = new TextEncoder().encode("export default { fetch() { return new Response('ok'); } }");

		const result = await provider.versions.upload({
			kind: "single_file",
			script_name: "anthropic-search",
			annotations: { version_set_id: "vs_v1" },
			vars,
			bundle,
		});
		expect(result.ok).toBe(true);

		expect(recorder.requests).toHaveLength(1);
		const req = recorder.requests[0];
		expect(req.method).toBe("POST");
		expect(req.pathname).toBe("/client/v4/accounts/acct_test/workers/scripts/anthropic-search/versions");
		expect(req.authorization).toBe("Bearer tok_test");
		expect(req.content_type ?? "").toMatch(/^multipart\/form-data; *boundary=/);
		expect(req.parts).not.toBeNull();

		const parts = req.parts!;
		expect(parts.metadata).toBeDefined();
		expect(parts.metadata.content_type ?? "").toMatch(/^application\/json/);
		const raw_metadata: unknown = JSON.parse(parts.metadata.text);
		const metadata = raw_metadata as {
			main_module: string;
			bindings: WorkerVar[];
			annotations: Record<string, string>;
			compatibility_date: string;
			compatibility_flags: string[];
		};
		expect(metadata.main_module).toBe("index.js");
		expect(metadata.annotations).toEqual({ version_set_id: "vs_v1" });
		expect(metadata.compatibility_date).toBe("2024-04-03");
		expect(metadata.compatibility_flags).toEqual([]);
		expect(metadata.bindings).toEqual([
			{ type: "plain_text", name: "CALLER_PACKAGE", text: "anthropic-search" },
			{ type: "plain_text", name: "CALLER_ENV", text: "production" },
			{ type: "plain_text", name: "CALLER_VERSION_SET_ID", text: "vs_v1" },
		]);

		expect(parts["index.js"]).toBeDefined();
		expect(parts["index.js"].content_type).toBe("application/javascript+module");
		expect(parts["index.js"].filename).toBe("index.js");
		expect(parts["index.js"].bytes.length).toBe(bundle.length);
	});

	test("versions.upload sends the configured non-plain_text bindings ahead of vars", async () => {
		recorder.next_response(() => ({
			success: true,
			errors: [],
			messages: [],
			result: { id: "ver_2", number: 2, metadata: { created_on: "2026-05-16T00:00:00Z" } },
		}));
		const provider = make_test_provider(recorder);

		const bundle = new TextEncoder().encode("export default {}");
		const result = await provider.versions.upload({
			kind: "single_file",
			script_name: "anthropic-search",
			bundle,
			bindings: [
				{ type: "service", name: "ANTHROPIC", service: "vault", entrypoint: "AnthropicVault" },
				{ type: "service", name: "PULSE", service: "pulse-api" },
			],
			vars: [{ type: "plain_text", name: "CALLER_PACKAGE", text: "anthropic-search" }],
			compatibility_date: "2026-05-17",
			compatibility_flags: ["nodejs_compat"],
		});
		expect(result.ok).toBe(true);

		const parts = recorder.requests[0].parts!;
		const raw_metadata: unknown = JSON.parse(parts.metadata.text);
		const metadata = raw_metadata as {
			bindings: Array<Record<string, unknown>>;
			compatibility_date: string;
			compatibility_flags: string[];
		};
		expect(metadata.compatibility_date).toBe("2026-05-17");
		expect(metadata.compatibility_flags).toEqual(["nodejs_compat"]);
		expect(metadata.bindings).toEqual([
			{ type: "service", name: "ANTHROPIC", service: "vault", entrypoint: "AnthropicVault" },
			{ type: "service", name: "PULSE", service: "pulse-api" },
			{ type: "plain_text", name: "CALLER_PACKAGE", text: "anthropic-search" },
		]);
	});

	test("versions.upload returns a validation error when bundle is missing", async () => {
		recorder.next_response(() => ({ success: true, errors: [], messages: [], result: {} }));
		const provider = make_test_provider(recorder);

		const result = await provider.versions.upload({ kind: "single_file", script_name: "test-pkg" });
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code).toBe("validation");
		expect(recorder.requests).toHaveLength(0);
	});

	test("versions.list decodes plain_text bindings back into WorkerVersion.vars", async () => {
		recorder.next_response(() => ({
			success: true,
			errors: [],
			messages: [],
			result: {
				items: [
					{
						id: "ver_1",
						number: 1,
						metadata: {
							created_on: "2026-05-16T00:00:00Z",
							bindings: [
								{ type: "plain_text", name: "CALLER_PACKAGE", text: "anthropic-search" },
								{ type: "plain_text", name: "CALLER_ENV", text: "production" },
								{ type: "plain_text", name: "CALLER_VERSION_SET_ID", text: "vs_abc" },
								{ type: "secret_text", name: "ANTHROPIC_API_KEY" },
							],
						},
						annotations: { version_set_id: "vs_abc" },
					},
				],
			},
		}));
		const provider = make_test_provider(recorder);

		const result = await provider.versions.list("anthropic-search");
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.value).toHaveLength(1);
		const v = result.value[0];
		// Secret bindings are dropped — only the plain_text trio surfaces on
		// `WorkerVersion.vars`.
		expect(v.vars).toEqual([
			{ type: "plain_text", name: "CALLER_PACKAGE", text: "anthropic-search" },
			{ type: "plain_text", name: "CALLER_ENV", text: "production" },
			{ type: "plain_text", name: "CALLER_VERSION_SET_ID", text: "vs_abc" },
		]);
	});

	test("versions.list returns undefined vars when no bindings present", async () => {
		recorder.next_response(() => ({
			success: true,
			errors: [],
			messages: [],
			result: {
				items: [{ id: "ver_2", number: 2, metadata: { created_on: "2026-05-16T00:00:00Z" }, annotations: {} }],
			},
		}));
		const provider = make_test_provider(recorder);

		const result = await provider.versions.list("test-pkg");
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value[0].vars).toBeUndefined();
	});
});
