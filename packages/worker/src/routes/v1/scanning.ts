import { scanning } from "@devpad/core/services";
import { Hono } from "hono";
import { stream } from "hono/streaming";
import { z } from "zod";
import type { AppContext } from "../../bindings.js";
import { requireAuth } from "../../middleware/auth.js";

const app = new Hono<AppContext>();

const scan_status_schema = z.object({
	id: z.number(),
	actions: z.record(z.string(), z.array(z.string())),
	titles: z.record(z.string(), z.string()),
	approved: z.boolean(),
});

app.post("/scan", requireAuth, async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;
	const session = c.get("session");

	if (!session?.access_token) return c.json({ error: "Authentication required" }, 401);

	const project_id = c.req.query("project_id");
	if (!project_id) return c.json({ error: "project_id parameter required" }, 400);

	return stream(c, async s => {
		try {
			for await (const chunk of scanning.initiateScan(db, project_id, auth_user.id, session.access_token!)) {
				await s.write(chunk);
			}
		} catch {
			await s.write("error: scan failed\n");
		}
	});
});

app.get("/updates", requireAuth, async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;
	const project_id = c.req.query("project_id");

	if (!project_id) return c.json({ error: "project_id required" }, 400);

	const result = await scanning.getPendingUpdates(db, project_id, auth_user.id);
	if (!result.ok) return c.json({ error: result.error.kind }, 500);
	return c.json({ updates: result.value });
});

app.post("/scan_status", requireAuth, async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;
	const project_id = c.req.query("project_id");

	if (!project_id) return c.json({ error: "project_id parameter required" }, 400);

	const body = await c.req.json();
	const parsed = scan_status_schema.safeParse(body);
	if (!parsed.success) return c.json({ error: "Invalid request body", details: parsed.error }, 400);

	const { id: update_id, actions, titles, approved } = parsed.data;

	const result = await scanning.processScanResults(db, project_id, auth_user.id, update_id, actions, titles, approved);
	if (!result.ok) return c.json({ error: result.error.kind }, 400);
	return c.json({ success: true });
});

export default app;
