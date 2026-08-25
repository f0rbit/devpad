import { hooks, projects } from "@devpad/core/services";
import { toggle_hook_enabled, upsert_hook } from "@devpad/schema/validation";
import { zValidator } from "@hono/zod-validator";
import type { Context } from "hono";
import { Hono } from "hono";
import type { AppContext } from "../../bindings.js";
import { requireAuth } from "../../middleware/auth.js";
import { isProjectScopeDenied, projectScopeDeniedResponse } from "../../middleware/scope-guard.js";

const app = new Hono<AppContext>();

const hook_delivery_status = new Set(["pending", "delivered", "failed_transient", "failed_permanent"]);

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

app.get("/", requireAuth, async (c) => {
	const db = c.get("db");
	const project_id = c.req.query("project_id");
	if (!project_id) return c.json({ error: "project_id required" }, 400);

	const guard = await assertProjectOwnership(c, project_id);
	if (!guard.ok) return guard.response;

	const result = await hooks.list_hooks(db, project_id);
	if (!result.ok) return c.json({ error: result.error.kind }, 500);
	return c.json(result.value);
});

app.post("/", requireAuth, zValidator("json", upsert_hook), async (c) => {
	const db = c.get("db");
	const config = c.get("config");
	const data = c.req.valid("json");

	const guard = await assertProjectOwnership(c, data.project_id);
	if (!guard.ok) return guard.response;

	const result = await hooks.upsert_hook(db, config.encryption_key, data);
	if (!result.ok) return c.json({ error: result.error.kind }, 500);
	return c.json(result.value);
});

app.patch("/:id", requireAuth, zValidator("json", upsert_hook), async (c) => {
	const db = c.get("db");
	const config = c.get("config");
	const id = c.req.param("id");
	const data = c.req.valid("json");

	const guard = await assertProjectOwnership(c, data.project_id);
	if (!guard.ok) return guard.response;

	const result = await hooks.upsert_hook(db, config.encryption_key, { ...data, id });
	if (!result.ok) {
		if (result.error.kind === "not_found") return c.json({ error: "Hook not found" }, 404);
		return c.json({ error: result.error.kind }, 500);
	}
	return c.json(result.value);
});

/** v2.4 (B3.4) — the settings panel's enable/disable toggle; never touches `trigger`/`action` (see `set_hook_enabled`'s doc comment on why this can't route through the general upsert). */
app.patch("/:id/enabled", requireAuth, zValidator("json", toggle_hook_enabled), async (c) => {
	const db = c.get("db");
	const id = c.req.param("id");
	const data = c.req.valid("json");

	const existing = await hooks.get_hook(db, id);
	if (!existing.ok) return c.json({ error: "Hook not found" }, 404);

	const guard = await assertProjectOwnership(c, existing.value.project_id);
	if (!guard.ok) return guard.response;

	const result = await hooks.set_hook_enabled(db, id, existing.value.project_id, data.enabled);
	if (!result.ok) {
		if (result.error.kind === "not_found") return c.json({ error: "Hook not found" }, 404);
		return c.json({ error: result.error.kind }, 500);
	}
	return c.json(result.value);
});

app.delete("/:id", requireAuth, async (c) => {
	const db = c.get("db");
	const id = c.req.param("id");

	const existing = await hooks.get_hook(db, id);
	if (!existing.ok) return c.json({ error: "Hook not found" }, 404);

	const guard = await assertProjectOwnership(c, existing.value.project_id);
	if (!guard.ok) return guard.response;

	const result = await hooks.delete_hook(db, id);
	if (!result.ok) return c.json({ error: result.error.kind }, 500);
	return c.json({ success: true });
});

app.get("/:id/deliveries", requireAuth, async (c) => {
	const db = c.get("db");
	const id = c.req.param("id");
	const status_param = c.req.query("status");
	if (status_param && !hook_delivery_status.has(status_param)) {
		return c.json({ error: "Invalid status filter" }, 400);
	}

	const existing = await hooks.get_hook(db, id);
	if (!existing.ok) return c.json({ error: "Hook not found" }, 404);

	const guard = await assertProjectOwnership(c, existing.value.project_id);
	if (!guard.ok) return guard.response;

	const result = await hooks.list_deliveries(
		db,
		id,
		status_param as "pending" | "delivered" | "failed_transient" | "failed_permanent" | undefined,
	);
	if (!result.ok) return c.json({ error: result.error.kind }, 500);
	return c.json(result.value);
});

export default app;
