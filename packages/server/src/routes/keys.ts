import { Hono } from "hono";
import { requireAuth, type AuthContext } from "../middleware/auth";
import { getAPIKeys, createApiKey, deleteApiKey } from "@devpad/core";
import { z } from "zod";

const app = new Hono<AuthContext>();

const createKeySchema = z.object({
	name: z.string().min(1).max(100).optional(),
});

/**
 * GET /api/keys
 * List all API keys for authenticated user
 */
app.get("/", requireAuth, async c => {
	const user = c.get("user");
	if (!user) {
		return c.json({ error: "Authentication required" }, 401);
	}

	try {
		const keys = await getAPIKeys(user.id);
		return c.json({ keys });
	} catch (err) {
		console.error("Get API keys error:", err);
		return c.json({ error: "Failed to fetch API keys" }, 500);
	}
});

/**
 * POST /api/keys/create
 * Create new API key for authenticated user
 */
app.post("/create", requireAuth, async c => {
	const user = c.get("user");
	if (!user) {
		return c.json({ error: "Authentication required" }, 401);
	}

	try {
		const body = await c.req.json();
		const parsed = createKeySchema.safeParse(body);

		if (!parsed.success) {
			return c.json(
				{
					error: "Invalid request body",
					details: parsed.error.issues,
				},
				400
			);
		}

		const { key, error } = await createApiKey(user.id, parsed.data.name || "API Key");
		if (error) {
			return c.json({ error }, 400);
		}

		return c.json({
			message: "API key created successfully",
			key,
		});
	} catch (err) {
		console.error("Create API key error:", err);
		return c.json({ error: "Failed to create API key" }, 500);
	}
});

/**
 * DELETE /api/keys/:key_id
 * Delete API key by ID (user can only delete their own keys)
 */
app.delete("/:key_id", requireAuth, async c => {
	const user = c.get("user");
	if (!user) {
		return c.json({ error: "Authentication required" }, 401);
	}

	const keyId = c.req.param("key_id");
	if (!keyId) {
		return c.json({ error: "Key ID required" }, 400);
	}

	try {
		const { success, error } = await deleteApiKey(keyId);
		if (error) {
			return c.json({ error }, 400);
		}
		if (!success) {
			return c.json({ error: "API key not found" }, 404);
		}

		return c.json({
			message: "API key deleted successfully",
			success: true,
		});
	} catch (err) {
		console.error("Delete API key error:", err);
		return c.json({ error: "Failed to delete API key" }, 500);
	}
});

export default app;
