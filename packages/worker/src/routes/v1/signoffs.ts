import { docs, graph, projects } from "@devpad/core/services";
import { decide_checkpoint_request, request_checkpoint_request } from "@devpad/schema/validation";
import { zValidator } from "@hono/zod-validator";
import type { Context } from "hono";
import { Hono } from "hono";
import type { AppContext } from "../../bindings.js";
import { requireAuth } from "../../middleware/auth.js";
import { isProjectScopeDenied, projectScopeDeniedResponse } from "../../middleware/scope-guard.js";

const app = new Hono<AppContext>();

async function assertProjectOwnership(c: Context<AppContext>, project_id: string) {
	const db = c.get("db");
	const auth_user = c.get("user");
	if (!auth_user) return { ok: false as const, response: c.json({ error: "Unauthorized" }, 401) };
	const project_result = await projects.getProjectById(db, project_id);
	if (!project_result.ok || project_result.value.owner_id !== auth_user.id) {
		return { ok: false as const, response: c.json({ error: "Project not found" }, 404) };
	}
	if (isProjectScopeDenied(c, project_id)) return { ok: false as const, response: projectScopeDeniedResponse(c) };
	return { ok: true as const };
}

function signoff_error_response(
	c: Context<AppContext>,
	error: { kind: string; message?: string; [k: string]: unknown },
) {
	if (error.kind === "not_found") return c.json(null, 404);
	if (error.kind === "approval_channel") return c.json({ error: error.message, task_id: error.task_id }, 403);
	if (error.kind === "conflict") return c.json({ error: error.message }, 409);
	if (error.kind === "bad_request") return c.json({ error: error.message }, 400);
	if (error.kind === "graph_conflict") return c.json({ error: error.message, current: error.current }, 409);
	return c.json({ error: error.kind }, 500);
}

app.post("/", requireAuth, zValidator("json", request_checkpoint_request), async (c) => {
	const db = c.get("db");
	const auth_user = c.get("user");
	if (!auth_user) return c.json({ error: "Unauthorized" }, 401);
	const data = c.req.valid("json");

	const guard = await assertProjectOwnership(c, data.project_id);
	if (!guard.ok) return guard.response;

	const auth_channel = c.get("auth_channel");
	const result = await docs.request_checkpoint(db, data, { owner_id: auth_user.id, auth_channel });
	if (!result.ok) return signoff_error_response(c, result.error);
	return c.json(result.value);
});

/** Signoffs have no `project_id` of their own — scope via the linked approval task, when one exists. */
async function assertSignoffOwnership(c: Context<AppContext>, signoff_task_id: string | null) {
	if (!signoff_task_id) return { ok: true as const };
	const db = c.get("db");
	const auth_user = c.get("user");
	if (!auth_user) return { ok: false as const, response: c.json({ error: "Unauthorized" }, 401) };
	const task_row = await graph.get_task_row(db, signoff_task_id);
	if (!task_row || task_row.owner_id !== auth_user.id) return { ok: false as const, response: c.json(null, 404) };
	if (isProjectScopeDenied(c, task_row.project_id))
		return { ok: false as const, response: projectScopeDeniedResponse(c) };
	return { ok: true as const };
}

app.get("/:id", requireAuth, async (c) => {
	const db = c.get("db");
	const id = c.req.param("id");
	const result = await docs.get_signoff(db, id);
	if (!result.ok) return signoff_error_response(c, result.error);

	const guard = await assertSignoffOwnership(c, result.value.task_id);
	if (!guard.ok) return guard.response;
	return c.json(result.value);
});

app.post("/:id/decide", requireAuth, zValidator("json", decide_checkpoint_request), async (c) => {
	const db = c.get("db");
	const auth_user = c.get("user");
	if (!auth_user) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	const data = c.req.valid("json");

	const existing = await docs.get_signoff(db, id);
	if (!existing.ok) return signoff_error_response(c, existing.error);
	const guard = await assertSignoffOwnership(c, existing.value.task_id);
	if (!guard.ok) return guard.response;

	const backend = c.get("docsBackend");
	if (!backend) return c.json({ error: "Docs corpus backend not configured" }, 503);

	const auth_channel = c.get("auth_channel");
	const result = await docs.decide_checkpoint(db, backend, id, data, { user_id: auth_user.id, auth_channel });
	if (!result.ok) return signoff_error_response(c, result.error);
	return c.json(result.value);
});

export default app;
