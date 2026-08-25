import { describe, expect, test } from "bun:test";
import type { Hook, TaskEvent } from "@devpad/schema";
import { hmac_sha256_hex, webhook_payload, WebhookActionExecutor } from "../../webhook.js";

const ENCRYPTION_KEY = "test-encryption-key";

function fakeEvent(overrides: Partial<TaskEvent> = {}): TaskEvent {
	return {
		id: 1,
		event_id: "evt_test",
		kind: "task.completed",
		subject_id: "task_test",
		project_id: "project_test",
		actor: "user",
		payload: { kind: "task.completed", via: "user" },
		occurred_at: "2026-01-01 00:00:00",
		dispatch_status: "pending",
		dispatched_at: null,
		...overrides,
	} as TaskEvent;
}

function fakeHook(overrides: Partial<Hook> = {}): Hook {
	return {
		id: "hook_test",
		project_id: "project_test",
		enabled: true,
		trigger: { kinds: ["task.completed"], selector: {} },
		action: { kind: "webhook", url: "https://example.com/hook" },
		created_at: "2026-01-01T00:00:00.000Z",
		updated_at: "2026-01-01T00:00:00.000Z",
		deleted: false,
		created_by: "api",
		modified_by: "api",
		protected: false,
		...overrides,
	} as Hook;
}

describe("WebhookActionExecutor (task A3.4)", () => {
	test("signs the raw body with HMAC-SHA256 over `${timestamp}.${body}`, verifiable by a receiver fixture", async () => {
		let captured: { url: string; headers: Record<string, string>; body: string } | undefined;
		const fetch_impl = (async (url: string | URL, init?: RequestInit) => {
			captured = {
				url: String(url),
				headers: Object.fromEntries(new Headers(init?.headers).entries()),
				body: String(init?.body),
			};
			return new Response(null, { status: 200 });
		}) as typeof fetch;

		const hook = fakeHook({
			action: { kind: "webhook", url: "https://example.com/hook", secret_encrypted: undefined },
		});
		// Encrypt a real secret so the executor has something to decrypt.
		const { secrets } = await import("../../../../media/utils.js");
		const encrypted = await secrets.encrypt("shh-its-a-secret", ENCRYPTION_KEY);
		if (!encrypted.ok) throw new Error("failed to encrypt test secret");
		hook.action = { kind: "webhook", url: "https://example.com/hook", secret_encrypted: encrypted.value };

		const executor = WebhookActionExecutor({ encryption_key: ENCRYPTION_KEY, fetch_impl });
		const event = fakeEvent();
		const result = await executor.execute({ action: hook.action, event, hook, delivery_id: "hdl_test" });

		expect(result).toEqual({ ok: true });
		expect(captured).toBeDefined();
		if (!captured) return;

		const timestamp = captured.headers["x-devpad-timestamp"];
		expect(timestamp).toBeDefined();
		expect(captured.body).toBe(webhook_payload(event, hook.id, "hdl_test"));

		// The receiver-side verification: independently recompute the HMAC over
		// the raw body it actually received and confirm it matches the header.
		const expected_signature = await hmac_sha256_hex("shh-its-a-secret", `${timestamp}.${captured.body}`);
		expect(captured.headers["x-devpad-signature"]).toBe(`sha256=${expected_signature}`);
	});

	test("sends unsigned when the hook has no secret configured", async () => {
		let captured_headers: Record<string, string> = {};
		const fetch_impl = (async (_url: string | URL, init?: RequestInit) => {
			captured_headers = Object.fromEntries(new Headers(init?.headers).entries());
			return new Response(null, { status: 200 });
		}) as typeof fetch;

		const hook = fakeHook();
		const executor = WebhookActionExecutor({ encryption_key: ENCRYPTION_KEY, fetch_impl });
		const result = await executor.execute({
			action: hook.action as never,
			event: fakeEvent(),
			hook,
			delivery_id: "hdl_test",
		});

		expect(result).toEqual({ ok: true });
		expect(captured_headers["x-devpad-signature"]).toBeUndefined();
	});

	test("classifies a 5xx response as transient and a 4xx response as permanent", async () => {
		const hook = fakeHook();
		const make = (status: number) =>
			WebhookActionExecutor({
				encryption_key: ENCRYPTION_KEY,
				fetch_impl: (async () => new Response(null, { status })) as typeof fetch,
			});

		const transient = await make(503).execute({
			action: hook.action as never,
			event: fakeEvent(),
			hook,
			delivery_id: "d1",
		});
		expect(transient).toEqual({ ok: false, transient: true, message: "webhook responded 503" });

		const permanent = await make(400).execute({
			action: hook.action as never,
			event: fakeEvent(),
			hook,
			delivery_id: "d2",
		});
		expect(permanent).toEqual({ ok: false, transient: false, message: "webhook responded 400" });
	});

	test("classifies a network error as transient", async () => {
		const hook = fakeHook();
		const executor = WebhookActionExecutor({
			encryption_key: ENCRYPTION_KEY,
			fetch_impl: (async () => {
				throw new Error("ECONNREFUSED");
			}) as typeof fetch,
		});
		const result = await executor.execute({
			action: hook.action as never,
			event: fakeEvent(),
			hook,
			delivery_id: "d3",
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.transient).toBe(true);
	});
});
