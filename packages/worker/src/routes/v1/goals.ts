import { goals } from "@devpad/core/services";
import { upsert_goal } from "@devpad/schema";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { AppContext } from "../../bindings.js";
import { requireAuth } from "../../middleware/auth.js";

const app = new Hono<AppContext>();

app.get("/", requireAuth, async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;

	const result = await goals.getUserGoals(db, auth_user.id);
	if (!result.ok) return c.json({ error: result.error.kind }, 500);
	return c.json(result.value);
});

app.get("/:id", requireAuth, async c => {
	const db = c.get("db");
	const goal_id = c.req.param("id");

	if (!goal_id) return c.json({ error: "Missing goal ID" }, 400);

	const result = await goals.getGoal(db, goal_id);
	if (!result.ok) {
		if (result.error.kind === "not_found") return c.json({ error: "Goal not found" }, 404);
		return c.json({ error: result.error.kind }, 500);
	}
	if (!result.value) return c.json({ error: "Goal not found" }, 404);
	return c.json(result.value);
});

app.post("/", requireAuth, zValidator("json", upsert_goal), async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;
	const data = c.req.valid("json");

	const result = await goals.upsertGoal(db, data, auth_user.id);
	if (!result.ok) {
		if (result.error.kind === "forbidden") return c.json({ error: result.error.message }, 401);
		if (result.error.kind === "not_found") return c.json({ error: `${result.error.entity} not found` }, 404);
		return c.json({ error: result.error.kind }, 500);
	}
	return c.json(result.value);
});

app.patch("/:id", requireAuth, zValidator("json", upsert_goal), async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;
	const goal_id = c.req.param("id");
	const data = c.req.valid("json");

	if (!goal_id) return c.json({ error: "Missing goal ID" }, 400);

	const update_data = { ...data, id: goal_id };
	const result = await goals.upsertGoal(db, update_data, auth_user.id);
	if (!result.ok) {
		if (result.error.kind === "forbidden") return c.json({ error: result.error.message }, 401);
		if (result.error.kind === "not_found") return c.json({ error: `${result.error.entity} not found` }, 404);
		return c.json({ error: result.error.kind }, 500);
	}
	return c.json(result.value);
});

app.delete("/:id", requireAuth, async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;
	const goal_id = c.req.param("id");

	if (!goal_id) return c.json({ error: "Missing goal ID" }, 400);

	const result = await goals.deleteGoal(db, goal_id, auth_user.id);
	if (!result.ok) {
		if (result.error.kind === "forbidden") return c.json({ error: result.error.message }, 401);
		if (result.error.kind === "not_found") return c.json({ error: `${result.error.entity} not found` }, 404);
		return c.json({ error: result.error.kind }, 500);
	}
	return c.json({ success: true, message: "Goal deleted" });
});

export default app;
