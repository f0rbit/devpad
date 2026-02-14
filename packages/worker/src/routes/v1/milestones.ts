import { milestones, projects } from "@devpad/core/services";
import { upsert_milestone } from "@devpad/schema";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { AppContext } from "../../bindings.js";
import { requireAuth } from "../../middleware/auth.js";

const app = new Hono<AppContext>();

app.get("/", requireAuth, async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;

	const result = await milestones.getUserMilestones(db, auth_user.id);
	if (!result.ok) return c.json({ error: result.error.kind }, 500);
	return c.json(result.value);
});

app.get("/:id", requireAuth, async c => {
	const db = c.get("db");
	const milestone_id = c.req.param("id");

	if (!milestone_id) return c.json({ error: "Missing milestone ID" }, 400);

	const result = await milestones.getMilestone(db, milestone_id);
	if (!result.ok) {
		if (result.error.kind === "not_found") return c.json({ error: "Milestone not found" }, 404);
		return c.json({ error: result.error.kind }, 500);
	}
	if (!result.value) return c.json({ error: "Milestone not found" }, 404);
	return c.json(result.value);
});

app.post("/", requireAuth, zValidator("json", upsert_milestone), async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;
	const data = c.req.valid("json");

	const result = await milestones.upsertMilestone(db, data, auth_user.id);
	if (!result.ok) {
		if (result.error.kind === "forbidden") return c.json({ error: result.error.message }, 401);
		if (result.error.kind === "not_found") return c.json({ error: `${result.error.entity} not found` }, 404);
		return c.json({ error: result.error.kind }, 500);
	}
	return c.json(result.value);
});

app.patch("/:id", requireAuth, zValidator("json", upsert_milestone), async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;
	const milestone_id = c.req.param("id");
	const data = c.req.valid("json");

	if (!milestone_id) return c.json({ error: "Missing milestone ID" }, 400);

	const update_data = { ...data, id: milestone_id };
	const result = await milestones.upsertMilestone(db, update_data, auth_user.id);
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
	const milestone_id = c.req.param("id");

	if (!milestone_id) return c.json({ error: "Missing milestone ID" }, 400);

	const result = await milestones.deleteMilestone(db, milestone_id, auth_user.id);
	if (!result.ok) {
		if (result.error.kind === "forbidden") return c.json({ error: result.error.message }, 401);
		if (result.error.kind === "not_found") return c.json({ error: `${result.error.entity} not found` }, 404);
		return c.json({ error: result.error.kind }, 500);
	}
	return c.json({ success: true, message: "Milestone deleted" });
});

app.get("/:id/goals", requireAuth, async c => {
	const db = c.get("db");
	const milestone_id = c.req.param("id");

	if (!milestone_id) return c.json({ error: "Missing milestone ID" }, 400);

	const milestone_result = await milestones.getMilestone(db, milestone_id);
	if (!milestone_result.ok) {
		if (milestone_result.error.kind === "not_found") return c.json({ error: "Milestone not found" }, 404);
		return c.json({ error: milestone_result.error.kind }, 500);
	}
	if (!milestone_result.value) return c.json({ error: "Milestone not found" }, 404);

	const { goals } = await import("@devpad/core/services");
	const result = await goals.getMilestoneGoals(db, milestone_id);
	if (!result.ok) return c.json({ error: result.error.kind }, 500);
	return c.json(result.value);
});

export default app;
