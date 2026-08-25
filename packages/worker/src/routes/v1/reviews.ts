import { docs } from "@devpad/core/services";
import { Hono } from "hono";
import type { AppContext } from "../../bindings.js";
import { requireAuth } from "../../middleware/auth.js";

const app = new Hono<AppContext>();

/**
 * v2.4 (task A4.6) — the human's queue, one typed aggregate across every
 * "needs a human" source. No project-scope filtering beyond ownership:
 * this is inherently a cross-project "what's waiting on me" view, so a
 * project-scoped API key doesn't get a narrower slice of it — it gets 403
 * from `requireAuth`'s ownership model not applying here at all. Scoped
 * purely to the authenticated user's own tasks/projects/packages.
 */
app.get("/pending", requireAuth, async (c) => {
	const db = c.get("db");
	const auth_user = c.get("user");
	if (!auth_user) return c.json({ error: "Unauthorized" }, 401);

	const result = await docs.pending_reviews(db, auth_user.id);
	if (!result.ok) return c.json({ error: result.error.kind }, 500);
	return c.json({ items: result.value });
});

export default app;
