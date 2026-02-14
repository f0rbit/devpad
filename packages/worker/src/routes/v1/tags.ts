import { tags } from "@devpad/core/services";
import { Hono } from "hono";
import type { AppContext } from "../../bindings.js";
import { requireAuth } from "../../middleware/auth.js";

const app = new Hono<AppContext>();

app.get("/", requireAuth, async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;

	const result = await tags.getActiveUserTags(db, auth_user.id);
	if (!result.ok) return c.json({ error: result.error.kind }, 500);
	return c.json(result.value);
});

export default app;
