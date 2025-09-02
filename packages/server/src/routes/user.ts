import { getUserById, updateUserPreferences } from "@devpad/core";
import { update_user } from "@devpad/schema";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { type AuthContext, requireAuth } from "../middleware/auth";

const app = new Hono<AuthContext>();

/**
 * PATCH /api/user/update_view
 * Update user preferences (task view, name, etc.)
 */
app.patch("/update_view", requireAuth, zValidator("json", update_user), async c => {
	try {
		const user = c.get("user");
		const data = c.req.valid("json");

		if (!user) {
			return c.json({ error: "Not authenticated" }, 401);
		}

		// Verify user can only update their own data
		if (user.id !== data.id) {
			return c.json({ error: "Forbidden" }, 403);
		}

		// Get full user data first
		const fullUser = await getUserById(user.id);
		if (!fullUser) {
			return c.json({ error: "User not found" }, 404);
		}

		// Update user preferences
		const updatedUser = await updateUserPreferences(user.id, {
			task_view: data.task_view,
			name: data.name,
			email: data.email_verified ? fullUser.email || undefined : undefined,
		});

		return c.json({
			id: updatedUser.id,
			name: updatedUser.name,
			task_view: updatedUser.task_view,
		});
	} catch (error) {
		console.error("User update error:", error);
		return c.json({ error: "Failed to update user" }, 500);
	}
});

export default app;
