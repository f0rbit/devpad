import { docs, projects } from "@devpad/core/services";
import { push_doc_request } from "@devpad/schema/validation";
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

function requireDocsBackend(c: Context<AppContext>) {
	const backend = c.get("docsBackend");
	if (!backend) return { ok: false as const, response: c.json({ error: "Docs corpus backend not configured" }, 503) };
	return { ok: true as const, backend };
}

app.get("/", requireAuth, async (c) => {
	const db = c.get("db");
	const project_id = c.req.query("project_id");
	const task_id = c.req.query("task_id");
	if (!project_id) return c.json({ error: "project_id required" }, 400);

	const guard = await assertProjectOwnership(c, project_id);
	if (!guard.ok) return guard.response;

	const result = await docs.list_documents(db, { project_id, task_id });
	if (!result.ok) return c.json({ error: result.error.kind }, 500);
	return c.json(result.value);
});

app.post("/", requireAuth, zValidator("json", push_doc_request), async (c) => {
	const db = c.get("db");
	const data = c.req.valid("json");

	const guard = await assertProjectOwnership(c, data.project_id);
	if (!guard.ok) return guard.response;

	const backend_guard = requireDocsBackend(c);
	if (!backend_guard.ok) return backend_guard.response;

	const auth_channel = c.get("auth_channel");
	const result = await docs.push_document(db, backend_guard.backend, data, auth_channel);
	if (!result.ok) {
		if (result.error.kind === "not_found")
			return c.json({ error: `Document ${data.document_id ?? ""} not found` }, 404);
		if (result.error.kind === "bad_request") return c.json({ error: result.error.message }, 400);
		if (result.error.kind === "invalid_content") return c.json({ error: result.error.message }, 400);
		return c.json({ error: result.error.kind }, 500);
	}
	return c.json(result.value);
});

app.get("/:id", requireAuth, async (c) => {
	const db = c.get("db");
	const id = c.req.param("id");
	const version = c.req.query("version");

	const doc_result = await docs.get_document(db, id);
	if (!doc_result.ok) return c.json(null, 404);
	const guard = await assertProjectOwnership(c, doc_result.value.project_id);
	if (!guard.ok) return guard.response;

	const backend_guard = requireDocsBackend(c);
	if (!backend_guard.ok) return backend_guard.response;

	if (!doc_result.value.head_version) return c.json({ document: doc_result.value, content: null });

	const content_result = await docs.get_version(backend_guard.backend, id, version);
	if (!content_result.ok) {
		if (content_result.error.kind === "not_found") return c.json(null, 404);
		return c.json({ error: content_result.error.kind }, 500);
	}
	return c.json({ document: doc_result.value, content: content_result.value });
});

app.get("/:id/versions", requireAuth, async (c) => {
	const db = c.get("db");
	const id = c.req.param("id");

	const doc_result = await docs.get_document(db, id);
	if (!doc_result.ok) return c.json(null, 404);
	const guard = await assertProjectOwnership(c, doc_result.value.project_id);
	if (!guard.ok) return guard.response;

	const backend_guard = requireDocsBackend(c);
	if (!backend_guard.ok) return backend_guard.response;

	const result = await docs.list_versions(backend_guard.backend, id);
	if (!result.ok) return c.json({ error: result.error.kind }, 500);
	return c.json(result.value);
});

export default app;
