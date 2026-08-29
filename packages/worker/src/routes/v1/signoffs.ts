import { docs, graph, projects } from "@devpad/core/services";
import { decide_checkpoint_request, request_checkpoint_request, signoff_checkpoint } from "@devpad/schema/validation";
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

/**
 * v2.4 (B3) — "is there something pending to decide right now" for a
 * subject+checkpoint. `subject_kind=doc_version` scopes ownership via the
 * document's project; `subject_kind=stage` scopes via the task itself.
 * `pipeline_gate` isn't wired to any UI in this phase — 400s rather than
 * silently returning an unscoped result.
 */
app.get("/", requireAuth, async (c) => {
	const db = c.get("db");
	const auth_user = c.get("user");
	if (!auth_user) return c.json({ error: "Unauthorized" }, 401);

	const subject_kind = c.req.query("subject_kind");
	const subject_id = c.req.query("subject_id");
	const checkpoint_parsed = signoff_checkpoint.safeParse(c.req.query("checkpoint"));
	if (subject_kind !== "doc_version" && subject_kind !== "stage") {
		return c.json({ error: "subject_kind must be 'doc_version' or 'stage'" }, 400);
	}
	if (!subject_id || !checkpoint_parsed.success)
		return c.json({ error: "subject_id and a valid checkpoint required" }, 400);
	const checkpoint = checkpoint_parsed.data;

	if (subject_kind === "doc_version") {
		const doc_result = await docs.get_document(db, subject_id);
		if (!doc_result.ok) return c.json(null, 404);
		const project_result = await projects.getProjectById(db, doc_result.value.project_id);
		if (!project_result.ok || project_result.value.owner_id !== auth_user.id) return c.json(null, 404);
		if (isProjectScopeDenied(c, doc_result.value.project_id)) return projectScopeDeniedResponse(c);
	} else {
		const task_row = await graph.get_task_row(db, subject_id);
		if (!task_row || task_row.owner_id !== auth_user.id) return c.json(null, 404);
		if (isProjectScopeDenied(c, task_row.project_id)) return projectScopeDeniedResponse(c);
	}

	const result = await docs.pending_signoff_for(db, subject_kind, subject_id, checkpoint);
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
