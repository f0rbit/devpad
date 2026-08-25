/**
 * @module core/services/hooks/actions/webhook
 *
 * v2.4 (task A3.4) — HMAC-signed webhook action executor. POSTs
 * `{event, subject, hook_id, delivery_id}` to the hook's configured URL with
 * `x-devpad-signature: sha256=<hex>` (HMAC-SHA256 over `${timestamp}.${body}`,
 * matching the Stripe-style timestamp-prefixed scheme) + `x-devpad-timestamp`.
 * Unsigned when the hook has no secret configured.
 */

import type { TaskEvent } from "@devpad/schema";
import { secrets } from "../../media/utils.js";
import type { ActionExecutor, ActionResult } from "../dispatch.js";

export type WebhookExecutorDeps = {
	encryption_key: string;
	/** Injectable for tests — production omits this and gets the real global `fetch`. */
	fetch_impl?: typeof fetch;
};

async function hmac_sha256_hex(secret: string, message: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
	return Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, "0")).join("");
}

function webhook_payload(event: TaskEvent, hook_id: string, delivery_id: string) {
	return JSON.stringify({ event: event.kind, subject: event.subject_id, hook_id, delivery_id });
}

export function WebhookActionExecutor(deps: WebhookExecutorDeps): ActionExecutor {
	return {
		async execute({ action, event, hook, delivery_id }): Promise<ActionResult> {
			if (action.kind !== "webhook") return { ok: false, transient: false, message: "executor/action kind mismatch" };

			const body = webhook_payload(event, hook.id, delivery_id);
			const timestamp = String(Date.now());
			const headers: Record<string, string> = {
				"content-type": "application/json",
				"x-devpad-timestamp": timestamp,
			};

			if (action.secret_encrypted) {
				const decrypted = await secrets.decrypt(action.secret_encrypted, deps.encryption_key);
				if (!decrypted.ok) {
					return { ok: false, transient: false, message: "failed to decrypt webhook secret" };
				}
				const signature = await hmac_sha256_hex(decrypted.value, `${timestamp}.${body}`);
				headers["x-devpad-signature"] = `sha256=${signature}`;
			}

			const fetch_impl = deps.fetch_impl ?? fetch;
			let response: Response;
			try {
				response = await fetch_impl(action.url, { method: "POST", headers, body });
			} catch (e) {
				return { ok: false, transient: true, message: `network error: ${e instanceof Error ? e.message : String(e)}` };
			}

			if (response.status >= 500)
				return { ok: false, transient: true, message: `webhook responded ${String(response.status)}` };
			if (!response.ok) return { ok: false, transient: false, message: `webhook responded ${String(response.status)}` };
			return { ok: true };
		},
	};
}

export { hmac_sha256_hex, webhook_payload };
