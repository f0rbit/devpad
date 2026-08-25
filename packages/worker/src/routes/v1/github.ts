import { hooks } from "@devpad/core/services";
import { Hono } from "hono";
import type { AppContext } from "../../bindings.js";

const app = new Hono<AppContext>();

/**
 * v2.4 (task A3.6) — GitHub App inbound webhook. Unauthenticated by
 * design (GitHub can't send devpad session/API-key auth) — the HMAC
 * signature IS the auth. Verified before any DB read, per the phase's
 * adversary checklist. Degrades to a clean 501 when
 * `GITHUB_WEBHOOK_SECRET` isn't provisioned yet, rather than crashing.
 */
app.post("/webhook", async (c) => {
	const config = c.get("config");
	if (!config.github_webhook_secret) {
		return c.json({ error: "GitHub App webhook not configured" }, 501);
	}

	const raw_body = await c.req.text();
	const signature_header = c.req.header("x-hub-signature-256") ?? null;
	const verified = await hooks.verify_github_signature(config.github_webhook_secret, raw_body, signature_header);
	if (!verified) return c.json({ error: "Invalid signature" }, 401);

	const delivery_guid = c.req.header("x-github-delivery");
	const event_type = c.req.header("x-github-event");
	if (!delivery_guid || !event_type) return c.json({ error: "Missing delivery headers" }, 400);

	const db = c.get("db");
	const result = await hooks.process_github_webhook(db, { delivery_guid, event_type, raw_body });
	if (!result.ok) return c.json({ error: result.error.kind }, 500);

	return c.json({ status: result.value.status, completed: result.value.task_ids });
});

export default app;
