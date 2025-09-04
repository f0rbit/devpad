import { initiateScan, processScanResults, upsertProject, log } from "@devpad/core";
import { upsert_project } from "@devpad/schema";
import { Hono } from "hono";
import { stream } from "hono/streaming";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { type AuthContext, requireAuth } from "../middleware/auth";

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
				log.error("Scan streaming error:", error);
				await stream.write("error: scan failed\n");
			}
		});
	} catch (error) {
		log.error("Project scan error:", error);
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
		log.error("Scan status error:", error);
		return c.json({ error: "Failed to process scan status" }, 500);
	}
});

/**
 * PATCH /api/project/upsert
 * Create or update a project (legacy compatibility endpoint)
 */
app.patch("/upsert", requireAuth, zValidator("json", upsert_project), async c => {
	try {
		const user = c.get("user")!;
		const data = c.req.valid("json");

		log.projects(" Upserting project:", {
			projectId: data.project_id,
			userId: user.id,
			mode: data.id ? "update" : "create",
		});

		// Assert that the owner_id matches the authenticated user
		if (data.owner_id && data.owner_id !== user.id) {
			log.error(" Unauthorized: owner_id mismatch", { user_id: user.id, owner_id: data.owner_id });
			return c.json({ error: "Unauthorized: owner_id mismatch" }, 401);
		}

		// Get access token from session if available for GitHub operations
		const session = c.get("session");
		const access_token = session?.access_token;

		const newProject = await upsertProject(data, user.id, access_token);
		console.log("✅ [PROJECTS] Project upserted successfully:", { id: newProject.id });

		return c.json(newProject);
	} catch (err: any) {
		log.error(" Upsert error:", err.message);
		if (err.message.includes("Unauthorized")) {
			return c.json({ error: err.message }, 401);
		}
		if (err.message.includes("Bad Request")) {
			return c.json({ error: err.message }, 400);
		}
		return c.json({ error: "Internal Server Error" }, 500);
	}
});

export default app;
