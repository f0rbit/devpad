import { action, users } from "@devpad/core/services";
import { update_user } from "@devpad/schema";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { AppContext } from "../../bindings.js";
import { requireAuth } from "../../middleware/auth.js";

const app = new Hono<AppContext>();

app.patch("/preferences", requireAuth, zValidator("json", update_user), async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;
	const data = c.req.valid("json");

	if (auth_user.id !== data.id) return c.json({ error: "Forbidden" }, 403);

	const user_result = await users.getUserById(db, auth_user.id);
	if (!user_result.ok) return c.json({ error: user_result.error.kind }, 500);
	if (!user_result.value) return c.json({ error: "User not found" }, 404);

	const update_result = await users.updateUserPreferences(db, auth_user.id, {
		id: auth_user.id,
		task_view: data.task_view,
		name: data.name,
		email_verified: data.email_verified,
	});
	if (!update_result.ok) return c.json({ error: update_result.error.kind }, 500);

	return c.json({
		id: update_result.value.id,
		name: update_result.value.name,
		task_view: update_result.value.task_view,
	});
});

app.get("/history", requireAuth, async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;

	const result = await action.getUserHistory(db, auth_user.id);
	if (!result.ok) return c.json({ error: result.error.kind }, 500);
	return c.json(result.value);
});

app.get("/me", requireAuth, async c => {
	const user = c.get("user")!;
	return c.json({
		id: user.id,
		name: user.name,
		github_id: user.github_id,
		task_view: user.task_view,
	});
});

export default app;
