import { action, tags, tasks } from "@devpad/core/services";
import { save_tags_request, upsert_todo } from "@devpad/schema";
import { tag } from "@devpad/schema/database";
import { zValidator } from "@hono/zod-validator";
import { inArray } from "drizzle-orm";
import { Hono } from "hono";
import type { AppContext } from "../../bindings.js";
import { requireAuth } from "../../middleware/auth.js";

const app = new Hono<AppContext>();

app.get("/", requireAuth, async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;
	const query = c.req.query();

	if (query.id) {
		const result = await tasks.getTask(db, query.id);
		if (!result.ok) return c.json({ error: result.error.kind }, 500);
		if (!result.value) return c.json(null, 404);
		if (result.value.task.owner_id !== auth_user.id) return c.json(null, 401);
		return c.json(result.value);
	}

	if (query.tag) {
		const result = await tasks.getTasksByTag(db, query.tag);
		if (!result.ok) return c.json({ error: result.error.kind }, 500);
		return c.json(result.value);
	}

	if (query.project) {
		const result = await tasks.getProjectTasks(db, query.project);
		if (!result.ok) return c.json({ error: result.error.kind }, 500);
		return c.json(result.value);
	}

	const result = await tasks.getUserTasks(db, auth_user.id);
	if (!result.ok) return c.json({ error: result.error.kind }, 500);
	return c.json(result.value);
});

app.get("/history/:task_id", requireAuth, async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;
	const task_id = c.req.param("task_id");

	if (!task_id) return c.json({ error: "Missing task_id parameter" }, 400);

	const task_result = await tasks.getTask(db, task_id);
	if (!task_result.ok) return c.json({ error: task_result.error.kind }, 500);
	if (!task_result.value) return c.json(null, 404);
	if (task_result.value.task.owner_id !== auth_user.id) return c.json({ error: "Unauthorized" }, 401);

	const result = await action.getTaskHistory(db, task_id);
	if (!result.ok) return c.json({ error: result.error.kind }, 500);
	return c.json(result.value);
});

app.patch("/", requireAuth, zValidator("json", upsert_todo), async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;
	const data = c.req.valid("json");
	const body = await c.req.json();

	if (data.owner_id !== auth_user.id) {
		return c.json({ error: "Unauthorized: owner_id mismatch" }, 401);
	}

	let tag_list: any[] = [];
	if (body.tags) {
		const tag_parse = save_tags_request.safeParse(body.tags);
		if (!tag_parse.success) return c.json({ error: tag_parse.error.message }, 400);
		tag_list = tag_parse.data;
	}

	const auth_channel = c.get("auth_channel");
	const result = await tasks.upsertTask(db, data, tag_list, auth_user.id, auth_channel);
	if (!result.ok) {
		if (result.error.kind === "forbidden") return c.json({ error: result.error.message }, 401);
		if (result.error.kind === "bad_request") return c.json({ error: result.error.message }, 400);
		return c.json({ error: result.error.kind }, 500);
	}
	return c.json(result.value);
});

app.patch("/save_tags", requireAuth, zValidator("json", save_tags_request), async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;
	const data = c.req.valid("json");

	for (const t of data) {
		if (t.owner_id && t.owner_id !== auth_user.id) {
			return c.json({ error: "Unauthorized: owner_id mismatch" }, 401);
		}
	}

	const results = await Promise.all(data.map(t => tags.upsertTag(db, t)));
	const failed = results.find(r => !r.ok);
	if (failed && !failed.ok) return c.json({ error: "Error saving tags" }, 500);

	const tag_ids = results.filter(r => r.ok).map(r => r.value);
	if (tag_ids.length !== data.length) return c.json({ error: "Tag upsert returned incorrect rows" }, 500);

	const full_tags = await db.select().from(tag).where(inArray(tag.id, tag_ids));
	return c.json(full_tags);
});

export default app;
