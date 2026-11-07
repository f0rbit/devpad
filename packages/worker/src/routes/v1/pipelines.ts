/**
 * @module worker/routes/v1/pipelines
 *
 * Server-to-server proxy for the pipelines orchestrator, modelled on
 * `pulse.ts`. GitHub issue #156: the ApiClient's `client.pipelines.*`
 * paths (`/runs`, `/grants`, `/packages`, ...) resolve relative to the
 * devpad base URL, but the main worker only mounted
 * `/pipelines/dashboard` — every other call 404'd (and the orchestrator
 * would otherwise trust a client-supplied `user_id`).
 *
 * Per-request flow:
 *
 *  1. devpad auth (`requireAuth`) → `user` + `auth_channel`
 *     ("user" = session cookie, "api" = API key).
 *  2. Ownership: resolve the package (via `pipeline_run.package_id`,
 *     `pipeline_grant.package_id`, or the body/query package_id) and
 *     require `pipeline_package.owner_id === user.id`, or — when the
 *     package is linked to a project — `doesUserOwnProject`. Not owned
 *     or not found ⇒ 404 (never 403 — don't leak existence).
 *  3. Project-scoped API keys (`api_key_project_id`) fail closed: a route
 *     with no project to match against is invisible to them.
 *  4. Human-only at the proxy: approve + grant decisions reject
 *     api-channel callers with 403
 *     `{ error: "human_approval_required" }` — defence in depth alongside
 *     the orchestrator's own check. Cancel/rollback are allowed for both
 *     channels.
 *  5. Forward `${pipelines_api_base}${path}` with the orchestrator bearer
 *     token, `X-Devpad-Actor: <user.id>` and
 *     `X-Devpad-Actor-Channel: <user|api>`. Client-supplied
 *     `X-Devpad-Actor*` headers never pass (fresh header map) and
 *     `user_id` keys are stripped from every forwarded body; `owner_id`
 *     is overridden with the authenticated caller everywhere. Unscoped
 *     list routes are filtered to owned packages before responding.
 *     Upstream `{ ok: true, value }` envelopes are unwrapped for
 *     ApiClient callers, `{ ok: false, error }` → devpad's
 *     `{ error: code, message }` shape.
 *  6. Orchestrator unreachable / not configured ⇒ 503
 *     `{ error: "pipelines_unreachable" }`. No caching.
 */

import { pipelines, projects } from "@devpad/core/services";
import { eq, inArray, or } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { pipeline_grant, pipeline_package, project } from "@devpad/schema";
import type { AppContext } from "../../bindings.js";
import { requireAuth } from "../../middleware/auth.js";

const app = new Hono<AppContext>();

/* ─── Body sanitizers ─────────────────────────────────────────────
 * The actor identity ALWAYS comes from devpad auth, never from the
 * client: strip client-supplied `user_id` keys from forwarded bodies
 * (the orchestrator keys decisions on them) and override client-supplied
 * `owner_id` ownership claims with the authenticated caller. */

const without_user_id = (body: Record<string, unknown>): Record<string, unknown> => {
	const { user_id: _user_id, ...rest } = body;
	return rest;
};

const without_owner_id = (body: Record<string, unknown>): Record<string, unknown> => {
	const { owner_id: _owner_id, ...rest } = body;
	return rest;
};

const parse_body = async (c: Context<AppContext>): Promise<Record<string, unknown>> =>
	(await c.req.json().catch(() => ({}))) as Record<string, unknown>;

/* ─── Guards ─────────────────────────────────────────────────────── */

/**
 * A project-scoped API key may only act on packages whose linked project
 * matches the key's project. Mismatch, or a route with no project at all
 * (e.g. an unlinked package, owner-keyed templates) ⇒ 404, failing
 * closed. Non-scoped keys (`api_key_project_id === null`) are unaffected.
 */
const guard_scoped_key = (c: Context<AppContext>, project_id: string | null): Response | null => {
	const scoped = c.get("api_key_project_id");
	if (scoped === null) return null;
	if (project_id === null || scoped !== project_id) {
		c.get("log")?.warning("pipelines_proxy_scoped_key_denied", { scoped_project_id: scoped, project_id });
		return c.json({ error: "Not found" }, 404);
	}
	return null;
};

/**
 * The established ownership rule for pipeline packages: the package's
 * `owner_id` matches the caller, OR (when the package is linked to a
 * project) the caller owns that project (core's `doesUserOwnProject`).
 * Not owned and not found are indistinguishable — both 404.
 */
const guard_owned_package = async (c: Context<AppContext>, package_id: string): Promise<Response | null> => {
	const db = c.get("db");
	const user = c.get("user");
	if (!user) return c.json({ error: "Unauthorized" }, 401);

	const pkg_result = await pipelines.get_package(db, package_id);
	if (!pkg_result.ok) {
		c.get("log")?.warning("pipelines_proxy_not_owned", { package_id, user_id: user.id });
		return c.json({ error: "Not found" }, 404);
	}
	const pkg = pkg_result.value;

	const scoped_denial = guard_scoped_key(c, pkg.project_id);
	if (scoped_denial) return scoped_denial;

	let owned = pkg.owner_id === user.id;
	if (!owned && pkg.project_id) {
		const ownership = await projects.doesUserOwnProject(db, user.id, pkg.project_id);
		if (ownership.ok && ownership.value) owned = true;
	}
	if (!owned) {
		c.get("log")?.warning("pipelines_proxy_not_owned", { package_id, user_id: user.id });
		return c.json({ error: "Not found" }, 404);
	}
	return null;
};

const guard_owned_run = async (c: Context<AppContext>, run_id: string): Promise<Response | null> => {
	const run_result = await pipelines.get_run(c.get("db"), run_id);
	if (!run_result.ok) {
		c.get("log")?.warning("pipelines_proxy_run_not_found", { run_id, user_id: c.get("user")?.id });
		return c.json({ error: "Not found" }, 404);
	}
	return guard_owned_package(c, run_result.value.package_id);
};

const guard_owned_grant = async (c: Context<AppContext>, grant_id: string): Promise<Response | null> => {
	const db = c.get("db");
	const rows = await db
		.select({ package_id: pipeline_grant.package_id })
		.from(pipeline_grant)
		.where(eq(pipeline_grant.id, grant_id));
	const row = rows.at(0);
	if (!row) {
		c.get("log")?.warning("pipelines_proxy_grant_not_found", { grant_id, user_id: c.get("user")?.id });
		return c.json({ error: "Not found" }, 404);
	}
	return guard_owned_package(c, row.package_id);
};

/** Approvals are human decisions made in the web UI while signed in. */
const guard_human_only = (c: Context<AppContext>): Response | null => {
	if (c.get("auth_channel") !== "user") {
		c.get("log")?.warning("pipelines_proxy_human_required", { path: c.req.path, user_id: c.get("user")?.id });
		return c.json({ error: "human_approval_required" }, 403);
	}
	return null;
};

/* ─── Owned-package id set (unscoped list filtering) ───────────── */

/**
 * Ids of every package the caller may see: directly owned, or linked to a
 * project they own. The orchestrator is a single-tenant bearer-token
 * surface, so unscoped list routes must be filtered here.
 */
const owned_package_ids = async (c: Context<AppContext>): Promise<Set<string>> => {
	const db = c.get("db");
	const user = c.get("user");
	if (!user) return new Set();

	const project_rows = await db.select({ id: project.id }).from(project).where(eq(project.owner_id, user.id));
	const project_ids = project_rows.map((p) => p.id);

	const where =
		project_ids.length > 0
			? or(eq(pipeline_package.owner_id, user.id), inArray(pipeline_package.project_id, project_ids))
			: eq(pipeline_package.owner_id, user.id);
	const rows = await db.select({ id: pipeline_package.id }).from(pipeline_package).where(where);
	return new Set(rows.map((row) => row.id));
};

/** Filter an upstream list (as `unknown`) down to owned-package rows. */
const list_ownership_filter =
	(owned: Set<string>, key: string) =>
	(value: unknown): unknown => {
		if (!Array.isArray(value)) return value;
		const rows = value as Array<Record<string, unknown>>;
		return rows.filter((row) => {
			const pid = row[key];
			return typeof pid === "string" && owned.has(pid);
		});
	};

/* ─── Forwarding ─────────────────────────────────────────────────── */

type ForwardOpts = {
	upstream_path: string;
	method: "GET" | "POST" | "PATCH" | "DELETE";
	/** Final query params for the upstream URL (already sanitized/overridden). */
	query?: Record<string, string>;
	/** Sanitized body object; forwarded as JSON when defined. */
	body?: unknown;
	/** Optional ownership filter applied to an upstream list envelope. */
	filter?: (value: unknown) => unknown;
};

/**
 * Forward a request to the orchestrator with devpad's bearer token and the
 * caller's actor identity as explicit headers. Does no auth/ownership of
 * its own beyond `requireAuth` — callers guard first.
 */
const forward_to_pipelines = async (c: Context<AppContext>, opts: ForwardOpts): Promise<Response> => {
	const config = c.get("config");
	const user = c.get("user");
	const api_base = config.pipelines_api_base;
	const token = config.pipelines_token;
	if (!user) return c.json({ error: "Unauthorized" }, 401);
	if (!api_base || !token) {
		c.get("log")?.warning("pipelines_proxy_unconfigured", { upstream_path: opts.upstream_path });
		return c.json({ error: "pipelines_unreachable" }, 503);
	}

	const url = new URL(`${api_base}${opts.upstream_path}`);
	for (const [key, value] of Object.entries(opts.query ?? {})) {
		if (value !== "") url.searchParams.set(key, value);
	}

	const headers: Record<string, string> = {
		Authorization: `Bearer ${token}`,
		"Content-Type": "application/json",
		"X-Devpad-Actor": user.id,
		"X-Devpad-Actor-Channel": c.get("auth_channel"),
	};

	const fetch_options: RequestInit = { method: opts.method, headers };
	if (opts.method !== "GET" && opts.body !== undefined) {
		fetch_options.body = JSON.stringify(opts.body);
	}

	let upstream: Response;
	try {
		upstream = await fetch(url.toString(), fetch_options);
	} catch {
		c.get("log")?.warning("pipelines_proxy_unreachable", { upstream_path: opts.upstream_path });
		return c.json({ error: "pipelines_unreachable" }, 503);
	}

	if (upstream.status === 502 || upstream.status === 503) {
		c.get("log")?.warning("pipelines_proxy_unreachable", {
			upstream_path: opts.upstream_path,
			status: upstream.status,
		});
		return c.json({ error: "pipelines_unreachable" }, 503);
	}
	if (upstream.status === 204) return c.body(null, 204);

	const text = await upstream.text();
	let parsed: unknown = null;
	try {
		const candidate: unknown = JSON.parse(text);
		parsed = candidate;
	} catch {
		parsed = null;
	}

	const envelope =
		typeof parsed === "object" && parsed !== null && "ok" in parsed
			? (parsed as { ok: boolean; value?: unknown; error?: unknown })
			: null;
	if (envelope !== null) {
		// Unwrap `{ ok: true, value }` — ApiClient callers expect the raw
		// value (`PipelineRun[]` etc.), not the orchestrator's envelope.
		if (envelope.ok) {
			const value = opts.filter !== undefined ? opts.filter(envelope.value) : envelope.value;
			return c.json(value as Record<string, unknown>, upstream.status as 200);
		}
		// `{ ok: false, error: { code, message?, ... } }` → devpad's plain
		// `{ error: "<code>", message }` — the shape ApiClient's error
		// handlers surface to callers.
		const err = (typeof envelope.error === "object" && envelope.error !== null ? envelope.error : {}) as {
			code?: unknown;
			message?: unknown;
		};
		const rest: Record<string, unknown> = {
			error: typeof err.code === "string" ? err.code : "pipelines_error",
		};
		if (typeof err.message === "string") rest.message = err.message;
		return c.json(rest, upstream.status as 400);
	}

	if (parsed !== null) {
		const value = opts.filter !== undefined ? opts.filter(parsed) : parsed;
		return c.json(value as Record<string, unknown>, upstream.status as 200);
	}
	return c.text(text, upstream.status as 200);
};

/* ─── Runs ───────────────────────────────────────────────────────── */

const forward_query = (c: Context<AppContext>): Record<string, string> =>
	Object.fromEntries(new URL(c.req.url).searchParams.entries());

app.post("/runs", requireAuth, async (c) => {
	const body = await parse_body(c);
	const package_id = typeof body.package_id === "string" ? body.package_id : "";
	if (package_id === "") return c.json({ error: "package_id required" }, 400);

	const denied = await guard_owned_package(c, package_id);
	if (denied) return denied;

	return forward_to_pipelines(c, { upstream_path: "/runs", method: "POST", body: without_user_id(body) });
});

/**
 * Unscoped list read: forward the upstream list and drop rows whose
 * package the caller can't see.
 */
app.get("/runs", requireAuth, async (c) => {
	const package_id = c.req.query("package_id");
	if (package_id) {
		const denied = await guard_owned_package(c, package_id);
		if (denied) return denied;
		const query = forward_query(c);
		delete query.package_id;
		return forward_to_pipelines(c, {
			upstream_path: "/runs",
			method: "GET",
			query: { ...query, package_id },
		});
	}
	const scoped_denial = guard_scoped_key(c, null);
	if (scoped_denial) return scoped_denial;
	const filter = list_ownership_filter(await owned_package_ids(c), "package_id");
	return forward_to_pipelines(c, { upstream_path: "/runs", method: "GET", query: forward_query(c), filter });
});

app.get("/runs/:id/events", requireAuth, async (c) => {
	const run_id = c.req.param("id");
	const denied = await guard_owned_run(c, run_id);
	if (denied) return denied;
	return forward_to_pipelines(c, { upstream_path: `/runs/${run_id}/events`, method: "GET" });
});

app.get("/runs/:id", requireAuth, async (c) => {
	const run_id = c.req.param("id");
	const denied = await guard_owned_run(c, run_id);
	if (denied) return denied;
	return forward_to_pipelines(c, { upstream_path: `/runs/${run_id}`, method: "GET" });
});

app.post("/runs/:id/events", requireAuth, async (c) => {
	const run_id = c.req.param("id");
	const denied = await guard_owned_run(c, run_id);
	if (denied) return denied;
	const body = await parse_body(c);
	return forward_to_pipelines(c, {
		upstream_path: `/runs/${run_id}/events`,
		method: "POST",
		body: without_user_id(body),
	});
});

/** Stage approval — HUMAN ONLY (session (`user`) channel). */
app.post("/runs/:id/approve", requireAuth, async (c) => {
	const run_id = c.req.param("id");
	const denied = await guard_owned_run(c, run_id);
	if (denied) return denied;

	const human_denial = guard_human_only(c);
	if (human_denial) return human_denial;

	const body = await parse_body(c);
	return forward_to_pipelines(c, {
		upstream_path: `/runs/${run_id}/approve`,
		method: "POST",
		body: without_user_id(body),
	});
});

app.post("/runs/:id/cancel", requireAuth, async (c) => {
	const run_id = c.req.param("id");
	const denied = await guard_owned_run(c, run_id);
	if (denied) return denied;
	const body = await parse_body(c);
	return forward_to_pipelines(c, {
		upstream_path: `/runs/${run_id}/cancel`,
		method: "POST",
		body: without_user_id(body),
	});
});

app.post("/runs/:id/rollback", requireAuth, async (c) => {
	const run_id = c.req.param("id");
	const denied = await guard_owned_run(c, run_id);
	if (denied) return denied;
	const body = await parse_body(c);
	return forward_to_pipelines(c, {
		upstream_path: `/runs/${run_id}/rollback`,
		method: "POST",
		body: without_user_id(body),
	});
});

/* ─── Grants ─────────────────────────────────────────────────────── */

app.get("/grants", requireAuth, async (c) => {
	const package_id = c.req.query("package_id");
	if (package_id) {
		const denied = await guard_owned_package(c, package_id);
		if (denied) return denied;
		return forward_to_pipelines(c, { upstream_path: "/grants", method: "GET", query: { package_id } });
	}
	const scoped_denial = guard_scoped_key(c, null);
	if (scoped_denial) return scoped_denial;
	const filter = list_ownership_filter(await owned_package_ids(c), "package_id");
	return forward_to_pipelines(c, { upstream_path: "/grants", method: "GET", filter });
});

/** Grant approval — HUMAN ONLY (session (`user`) channel). */
app.post("/grants/:id/approve", requireAuth, async (c) => {
	const grant_id = c.req.param("id");
	const denied = await guard_owned_grant(c, grant_id);
	if (denied) return denied;

	const human_denial = guard_human_only(c);
	if (human_denial) return human_denial;

	return forward_to_pipelines(c, { upstream_path: `/grants/${grant_id}/approve`, method: "POST", body: {} });
});

/** Grant denial — HUMAN ONLY (session (`user`) channel). */
app.post("/grants/:id/deny", requireAuth, async (c) => {
	const grant_id = c.req.param("id");
	const denied = await guard_owned_grant(c, grant_id);
	if (denied) return denied;

	const human_denial = guard_human_only(c);
	if (human_denial) return human_denial;

	const body = await parse_body(c);
	const forward_body = typeof body.reason === "string" ? { reason: body.reason } : {};
	return forward_to_pipelines(c, { upstream_path: `/grants/${grant_id}/deny`, method: "POST", body: forward_body });
});

/* ─── Packages ───────────────────────────────────────────────────── */

app.get("/packages", requireAuth, async (c) => {
	const project_id = c.req.query("project_id");
	const user = c.get("user");
	if (project_id && user) {
		const scoped_denial = guard_scoped_key(c, project_id);
		if (scoped_denial) return scoped_denial;
		const ownership = await projects.doesUserOwnProject(c.get("db"), user.id, project_id);
		if (!ownership.ok || !ownership.value) {
			c.get("log")?.warning("pipelines_proxy_not_owned", { project_id, user_id: user.id });
			return c.json({ error: "Not found" }, 404);
		}
		return forward_to_pipelines(c, { upstream_path: "/packages", method: "GET", query: { project_id } });
	}
	const scoped_denial = guard_scoped_key(c, null);
	if (scoped_denial) return scoped_denial;
	const filter = list_ownership_filter(await owned_package_ids(c), "id");
	return forward_to_pipelines(c, { upstream_path: "/packages", method: "GET", filter });
});

app.get("/packages/:id", requireAuth, async (c) => {
	const package_id = c.req.param("id");
	const denied = await guard_owned_package(c, package_id);
	if (denied) return denied;
	return forward_to_pipelines(c, { upstream_path: `/packages/${package_id}`, method: "GET" });
});

app.post("/packages", requireAuth, async (c) => {
	const user = c.get("user");
	if (!user) return c.json({ error: "Unauthorized" }, 401);

	const body = await parse_body(c);
	const project_id = typeof body.project_id === "string" ? body.project_id : null;

	const scoped_denial = guard_scoped_key(c, project_id);
	if (scoped_denial) return scoped_denial;

	if (project_id) {
		const ownership = await projects.doesUserOwnProject(c.get("db"), user.id, project_id);
		if (!ownership.ok || !ownership.value) {
			c.get("log")?.warning("pipelines_proxy_not_owned", { project_id, user_id: user.id });
			return c.json({ error: "Not found" }, 404);
		}
	}

	return forward_to_pipelines(c, {
		upstream_path: "/packages",
		method: "POST",
		body: { ...without_owner_id(body), owner_id: user.id },
	});
});

app.patch("/packages/:id", requireAuth, async (c) => {
	const package_id = c.req.param("id");
	const denied = await guard_owned_package(c, package_id);
	if (denied) return denied;

	const body = await parse_body(c);
	if (typeof body.project_id === "string") {
		const scoped_denial = guard_scoped_key(c, body.project_id);
		if (scoped_denial) return scoped_denial;
		const ownership = await projects.doesUserOwnProject(c.get("db"), c.get("user")?.id ?? "", body.project_id);
		if (!ownership.ok || !ownership.value) {
			c.get("log")?.warning("pipelines_proxy_not_owned", { project_id: body.project_id, user_id: c.get("user")?.id });
			return c.json({ error: "Not found" }, 404);
		}
	}

	return forward_to_pipelines(c, {
		upstream_path: `/packages/${package_id}`,
		method: "PATCH",
		body: without_owner_id(body),
	});
});

app.delete("/packages/:id", requireAuth, async (c) => {
	const package_id = c.req.param("id");
	const denied = await guard_owned_package(c, package_id);
	if (denied) return denied;
	return forward_to_pipelines(c, { upstream_path: `/packages/${package_id}`, method: "DELETE" });
});

/* ─── Analysis templates + OIDC trust ───────────────────────────── */

/**
 * Template + trust-policy operations are keyed by `owner_id` in every
 * upstream body/query. The proxy always overrides it with the
 * authenticated caller — clients can never read or write someone else's
 * rows. Project-scoped API keys fail closed (no project linkage here),
 * which is what `guard_scoped_key(c, null)` expresses.
 */

const owner_override_query = (c: Context<AppContext>): Record<string, string> => ({
	owner_id: c.get("user")?.id ?? "",
});

const guard_owner_scoped = async (c: Context<AppContext>): Promise<Response | null> => guard_scoped_key(c, null);

app.get("/analysis-templates", requireAuth, async (c) => {
	const denied = await guard_owner_scoped(c);
	if (denied) return denied;
	return forward_to_pipelines(c, {
		upstream_path: "/analysis-templates",
		method: "GET",
		query: owner_override_query(c),
	});
});

app.get("/analysis-templates/:id", requireAuth, async (c) => {
	const denied = await guard_owner_scoped(c);
	if (denied) return denied;
	return forward_to_pipelines(c, {
		upstream_path: `/analysis-templates/${c.req.param("id")}`,
		method: "GET",
		query: owner_override_query(c),
	});
});

app.post("/analysis-templates", requireAuth, async (c) => {
	const denied = await guard_owner_scoped(c);
	if (denied) return denied;
	const user = c.get("user");
	if (!user) return c.json({ error: "Unauthorized" }, 401);
	const body = await parse_body(c);
	return forward_to_pipelines(c, {
		upstream_path: "/analysis-templates",
		method: "POST",
		body: { ...without_owner_id(body), owner_id: user.id },
	});
});

app.patch("/analysis-templates/:id", requireAuth, async (c) => {
	const denied = await guard_owner_scoped(c);
	if (denied) return denied;
	const user = c.get("user");
	if (!user) return c.json({ error: "Unauthorized" }, 401);
	const body = await parse_body(c);
	return forward_to_pipelines(c, {
		upstream_path: `/analysis-templates/${c.req.param("id")}`,
		method: "PATCH",
		body: { ...without_owner_id(body), owner_id: user.id },
	});
});

app.delete("/analysis-templates/:id", requireAuth, async (c) => {
	const denied = await guard_owner_scoped(c);
	if (denied) return denied;
	return forward_to_pipelines(c, {
		upstream_path: `/analysis-templates/${c.req.param("id")}`,
		method: "DELETE",
		query: owner_override_query(c),
	});
});

app.get("/oidc-trust", requireAuth, async (c) => {
	const denied = await guard_owner_scoped(c);
	if (denied) return denied;
	return forward_to_pipelines(c, { upstream_path: "/oidc-trust", method: "GET", query: owner_override_query(c) });
});

app.get("/oidc-trust/:id", requireAuth, async (c) => {
	const denied = await guard_owner_scoped(c);
	if (denied) return denied;
	return forward_to_pipelines(c, {
		upstream_path: `/oidc-trust/${c.req.param("id")}`,
		method: "GET",
		query: owner_override_query(c),
	});
});

app.post("/oidc-trust", requireAuth, async (c) => {
	const denied = await guard_owner_scoped(c);
	if (denied) return denied;
	const user = c.get("user");
	if (!user) return c.json({ error: "Unauthorized" }, 401);
	const body = await parse_body(c);
	return forward_to_pipelines(c, {
		upstream_path: "/oidc-trust",
		method: "POST",
		body: { ...without_owner_id(body), owner_id: user.id },
	});
});

app.patch("/oidc-trust/:id", requireAuth, async (c) => {
	const denied = await guard_owner_scoped(c);
	if (denied) return denied;
	const user = c.get("user");
	if (!user) return c.json({ error: "Unauthorized" }, 401);
	const body = await parse_body(c);
	return forward_to_pipelines(c, {
		upstream_path: `/oidc-trust/${c.req.param("id")}`,
		method: "PATCH",
		body: { ...without_owner_id(body), owner_id: user.id },
	});
});

app.delete("/oidc-trust/:id", requireAuth, async (c) => {
	const denied = await guard_owner_scoped(c);
	if (denied) return denied;
	return forward_to_pipelines(c, {
		upstream_path: `/oidc-trust/${c.req.param("id")}`,
		method: "DELETE",
		query: owner_override_query(c),
	});
});

export default app;
