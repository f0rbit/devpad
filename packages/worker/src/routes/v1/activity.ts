import { action } from "@devpad/core/services";
import { Hono } from "hono";
import type { AppContext } from "../../bindings.js";
import { requireAuth } from "../../middleware/auth.js";

const app = new Hono<AppContext>();

app.get("/ai", requireAuth, async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;
	const query = c.req.query();

	const options: { limit?: number; since?: string } = {};
	if (query.limit) options.limit = parseInt(query.limit, 10);
	if (query.since) options.since = query.since;

	const result = await action.getAIActivity(db, auth_user.id, options);
	if (!result.ok) return c.json({ error: result.error.kind }, 500);
	return c.json({ sessions: result.value });
});

export default app;
