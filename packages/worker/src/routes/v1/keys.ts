import { keys } from "@devpad/core/auth";
import { Hono } from "hono";
import { z } from "zod";
import type { AppContext } from "../../bindings.js";
import { requireAuth } from "../../middleware/auth.js";

const app = new Hono<AppContext>();

const create_key_schema = z.object({
	name: z.string().min(1).max(100).optional(),
});

app.get("/", requireAuth, async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;

	const result = await keys.getAPIKeys(db, auth_user.id);
	if (!result.ok) return c.json({ error: "Failed to fetch API keys" }, 500);
	return c.json(result.value);
});

app.post("/", requireAuth, async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;

	const body = await c.req.json();
	const parsed = create_key_schema.safeParse(body);
	if (!parsed.success) return c.json({ error: "Invalid request body", details: parsed.error.issues }, 400);

	const result = await keys.createApiKey(db, auth_user.id, "devpad", parsed.data.name);
	if (!result.ok) return c.json({ error: "Failed to create API key" }, 500);

	return c.json({ message: "API key created successfully", key: result.value });
});

app.delete("/:key_id", requireAuth, async c => {
	const db = c.get("db");
	const key_id = c.req.param("key_id");

	if (!key_id) return c.json({ error: "Key ID required" }, 400);

	const result = await keys.deleteApiKey(db, key_id);
	if (!result.ok) {
		if (result.error.kind === "not_found") return c.json({ error: "API key not found" }, 404);
		return c.json({ error: "Failed to delete API key" }, 500);
	}

	return c.json({ message: "API key deleted successfully", success: true });
});

export default app;
