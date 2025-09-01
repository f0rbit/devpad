import { Hono } from "hono";
import { stream } from "hono/streaming";
import { requireAuth, type AuthContext } from "../middleware/auth";
import { initiateScan, processScanResults } from "@devpad/core";
import { z } from "zod";

const app = new Hono<AuthContext>();

const scanStatusSchema = z.object({
	id: z.number(),
	actions: z.record(z.string(), z.array(z.string())), // UpdateAction -> task_id[]
	titles: z.record(z.string(), z.string()), // task_id -> title
	approved: z.boolean(),
});

/**
 * POST /api/project/scan?project_id=<id>
 * Initiate repository scan and stream results
 */
app.post("/scan", requireAuth, async c => {
	try {
		const user = c.get("user");
		const session = c.get("session");

		if (!user || !session?.access_token) {
			return c.json({ error: "Authentication required" }, 401);
		}

		const projectId = c.req.query("project_id");
		if (!projectId) {
			return c.json({ error: "project_id parameter required" }, 400);
		}

		// Stream the scan results
		return stream(c, async stream => {
			try {
				for await (const chunk of initiateScan(projectId, user.id, session.access_token)) {
					await stream.write(chunk);
				}
			} catch (error) {
				console.error("Scan streaming error:", error);
				await stream.write("error: scan failed\n");
			}
		});
	} catch (error) {
		console.error("Project scan error:", error);
		return c.json({ error: "Scan failed" }, 500);
	}
});

/**
 * POST /api/project/scan_status?project_id=<id>
 * Process scan status updates and task actions
 */
app.post("/scan_status", requireAuth, async c => {
	try {
		const user = c.get("user");

		if (!user) {
			return c.json({ error: "Authentication required" }, 401);
		}

		const projectId = c.req.query("project_id");
		if (!projectId) {
			return c.json({ error: "project_id parameter required" }, 400);
		}

		const body = await c.req.json();
		const parsed = scanStatusSchema.safeParse(body);

		if (!parsed.success) {
			return c.json({ error: "Invalid request body", details: parsed.error }, 400);
		}

		const { id: updateId, actions, titles, approved } = parsed.data;

		// Process the scan results
		const result = await processScanResults(projectId, user.id, updateId, actions, titles, approved);

		if (!result.success) {
			return c.json({ error: result.error }, 400);
		}

		return c.json({ success: true });
	} catch (error) {
		console.error("Scan status error:", error);
		return c.json({ error: "Failed to process scan status" }, 500);
	}
});

export default app;
