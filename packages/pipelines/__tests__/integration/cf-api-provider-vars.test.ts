/**
 * @module pipelines/__tests__/integration/cf-api-provider-vars
 *
 * Task 5.C — verify the production CF REST client forwards the
 * caller-identity trio as `metadata.bindings` on the upload request, and
 * decodes them back on `versions.list`. Spins up a real `Bun.serve()`
 * that captures every request body, then drives the provider against it.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import type { WorkerVar } from "@devpad/pipeline-fakes";
import { make_cf_api_provider } from "../../src/providers/cf-api-provider.ts";

type RecordedRequest = {
	method: string;
	pathname: string;
	authorization: string | null;
	body: unknown;
};

type RecorderHandle = {
	server: Server;
	base_url: string;
	requests: RecordedRequest[];
	next_response: (handler: (req: RecordedRequest) => unknown) => void;
};

const start_recorder = (): RecorderHandle => {
	const requests: RecordedRequest[] = [];
	let responder: (req: RecordedRequest) => unknown = () => ({
		success: true,
		errors: [],
		messages: [],
		result: {},
	});

	const server = Bun.serve({
		port: 0,
		async fetch(req) {
			const url = new URL(req.url);
			const text = await req.text();
			let body: unknown = text;
			if (text.length > 0) {
				try {
					body = JSON.parse(text);
				} catch {
					/* leave as string */
				}
			}
			const record: RecordedRequest = {
				method: req.method,
				pathname: url.pathname,
				authorization: req.headers.get("authorization"),
				body,
			};
			requests.push(record);
			const payload = responder(record);
			return new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } });
		},
	});

	return {
		server,
		base_url: `http://localhost:${server.port}/client/v4`,
		requests,
		next_response: handler => {
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

	afterEach(() => {
		recorder.server.stop(true);
	});

	test("versions.upload posts metadata.bindings with the trio in plain_text form", async () => {
		recorder.next_response(() => ({
			success: true,
			errors: [],
			messages: [],
			result: { id: "ver_abc", number: 42, metadata: { created_on: "2026-05-16T00:00:00Z" }, annotations: { version_set_id: "vs_v1" } },
		}));
		const provider = make_test_provider(recorder);

		const vars: WorkerVar[] = [
			{ type: "plain_text", name: "CALLER_PACKAGE", text: "anthropic-search" },
			{ type: "plain_text", name: "CALLER_ENVIRONMENT", text: "production" },
			{ type: "plain_text", name: "CALLER_VERSION_SET_ID", text: "vs_v1" },
		];

		const result = await provider.versions.upload({
			script_name: "anthropic-search",
			annotations: { version_set_id: "vs_v1" },
			vars,
		});
		expect(result.ok).toBe(true);

		expect(recorder.requests).toHaveLength(1);
		const req = recorder.requests[0];
		expect(req.method).toBe("POST");
		expect(req.pathname).toBe("/client/v4/accounts/acct_test/workers/scripts/anthropic-search/versions");
		expect(req.authorization).toBe("Bearer tok_test");

		const body = req.body as { annotations: Record<string, string>; metadata: { bindings: WorkerVar[] } };
		expect(body.annotations).toEqual({ version_set_id: "vs_v1" });
		expect(body.metadata).toBeDefined();
		expect(body.metadata.bindings).toEqual([
			{ type: "plain_text", name: "CALLER_PACKAGE", text: "anthropic-search" },
			{ type: "plain_text", name: "CALLER_ENVIRONMENT", text: "production" },
			{ type: "plain_text", name: "CALLER_VERSION_SET_ID", text: "vs_v1" },
		]);
	});

	test("versions.upload sends an empty bindings array when no vars are supplied (backward compat)", async () => {
		recorder.next_response(() => ({
			success: true,
			errors: [],
			messages: [],
			result: { id: "ver_xyz", number: 1, metadata: { created_on: "2026-05-16T00:00:00Z" } },
		}));
		const provider = make_test_provider(recorder);

		const result = await provider.versions.upload({ script_name: "test-pkg" });
		expect(result.ok).toBe(true);

		const body = recorder.requests[0].body as { metadata: { bindings: WorkerVar[] } };
		expect(body.metadata.bindings).toEqual([]);
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
								{ type: "plain_text", name: "CALLER_ENVIRONMENT", text: "production" },
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
			{ type: "plain_text", name: "CALLER_ENVIRONMENT", text: "production" },
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
