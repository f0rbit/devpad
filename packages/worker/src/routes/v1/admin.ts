import { graph } from "@devpad/core/services";
import { Hono } from "hono";
import type { AppContext } from "../../bindings.js";
import { requireAuth } from "../../middleware/auth.js";
import { isProjectScopeDenied, projectScopeDeniedResponse } from "../../middleware/scope-guard.js";

const app = new Hono<AppContext>();

/**
 * v2.4 (task A5.3) — dual-read verification for the milestone/goal fold.
 * Scoped to the calling user's own projects (not a system-wide dump) — this
 * is a per-account diagnostic, run by the account owner via
 * `devpad admin verify-fold`, not a public admin surface. The verifier runs
 * this against staging then production post-deploy; Arc B does not start
 * until both report clean.
 */
app.get("/verify-fold", requireAuth, async (c) => {
	const db = c.get("db");
	const auth_user = c.get("user");
	if (!auth_user) return c.json({ error: "Unauthorized" }, 401);
	// This diagnostic spans every one of the caller's projects — a
	// project-scoped API key has no single project_id to check against, so
	// it's denied outright rather than silently narrowed.
	if (isProjectScopeDenied(c, null)) return projectScopeDeniedResponse(c);

	const result = await graph.verify_fold(db, auth_user.id);
	if (!result.ok) return c.json({ error: result.error.kind }, 500);
	return c.json(result.value);
});

export default app;
