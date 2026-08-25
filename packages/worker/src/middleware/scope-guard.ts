import type { Context } from "hono";
import type { AppContext } from "../bindings.js";

/**
 * v2.4 (task A3.1) — the shared least-privilege guard for project-scoped API
 * keys. A key with `api_key_project_id` set may only touch resources
 * belonging to that project; cookie auth and legacy (null-scope) keys are
 * unaffected. Callers resolve the resource's `project_id` themselves (after
 * the existing ownership check) and call this immediately after.
 */
export function isProjectScopeDenied(c: Context<AppContext>, resource_project_id: string | null | undefined): boolean {
	const scoped_project_id = c.get("api_key_project_id");
	if (!scoped_project_id) return false;
	return resource_project_id !== scoped_project_id;
}

export function projectScopeDeniedResponse(c: Context<AppContext>) {
	return c.json({ error: "Forbidden: API key is scoped to a different project" }, 403);
}
