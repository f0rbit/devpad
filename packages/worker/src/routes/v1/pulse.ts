import { projects } from "@devpad/core/services";
import type { Context } from "hono";
import { Hono } from "hono";
import type { AppContext } from "../../bindings.js";
import { requireAuth } from "../../middleware/auth.js";

const app = new Hono<AppContext>();

type ForwardOpts = {
	pulse_path: string;
	method?: "GET" | "POST" | "PATCH" | "DELETE";
	/** Forward the inbound query string verbatim. Useful for read endpoints
	 * that accept arbitrary filter params we don't want to enumerate. */
	forward_query?: boolean;
	/** Extra query params merged AFTER the inbound forward (caller wins). */
	extra_query?: Record<string, string>;
};

/**
 * Forward a request to the pulse worker with devpad's internal API key. The
 * caller is responsible for ownership checks BEFORE invoking this — `forward_to_pulse`
 * does no auth of its own beyond stamping the upstream Bearer header.
 */
const forward_to_pulse = async (c: Context<AppContext>, opts: ForwardOpts): Promise<Response> => {
	const config = c.get("config");
	const pulse_api_base = config.pulse_api_base;
	const pulse_internal_key = config.pulse_internal_key;

	if (!pulse_api_base || !pulse_internal_key) {
		return c.json({ error: "Pulse integration not configured" }, 503);
	}

	const method = opts.method ?? "GET";
	const url = new URL(`${pulse_api_base}${opts.pulse_path}`);

	if (opts.forward_query) {
		const inbound = c.req.query();
		for (const [key, value] of Object.entries(inbound)) {
			url.searchParams.set(key, value);
		}
	}
	for (const [key, value] of Object.entries(opts.extra_query ?? {})) {
		url.searchParams.set(key, value);
	}

	const headers: Record<string, string> = {
		Authorization: `Bearer ${pulse_internal_key}`,
		"Content-Type": "application/json",
	};
	const fetch_options: RequestInit = { method, headers };

	if (method !== "GET") {
		const body_text = await c.req.text();
		if (body_text.length > 0) fetch_options.body = body_text;
	}

	let response: Response;
	try {
		response = await fetch(url.toString(), fetch_options);
	} catch {
		c.get("log")?.warning("pulse_proxy_unreachable", { pulse_path: opts.pulse_path });
		return c.json({ error: "pulse_unreachable" }, 503);
	}

	if (response.status === 502 || response.status === 503) {
		c.get("log")?.warning("pulse_proxy_unreachable", { pulse_path: opts.pulse_path });
		return c.json({ error: "pulse_unreachable" }, 503);
	}

	const content_type = response.headers.get("content-type") ?? "";
	if (response.status === 204) return c.body(null, 204);

	if (content_type.includes("application/json")) {
		const data = await response.json();
		return c.json(data as Record<string, unknown>, response.status as 200);
	}

	const text = await response.text();
	return c.text(text, response.status as 200);
};

const project_param = (c: Context<AppContext>): string | null => c.req.param("project_id") ?? null;

const guard_project_owner = async (c: Context<AppContext>, project_id: string): Promise<Response | null> => {
	const db = c.get("db");
	const user = c.get("user");
	if (!user) return c.json({ error: "Unauthorized" }, 401);

	const ownership = await projects.doesUserOwnProject(db, user.id, project_id);
	if (!ownership.ok || !ownership.value) {
		c.get("log")?.warning("pulse_proxy_forbidden", { project_id, user_id: user.id });
		return c.json({ error: "Forbidden" }, 403);
	}
	return null;
};

/* --------------------------------------------------------------------- reads */

app.get("/summary/:project_id", requireAuth, async c => {
	const project_id = project_param(c);
	if (!project_id) return c.json({ error: "Project ID required" }, 400);

	const guard = await guard_project_owner(c, project_id);
	if (guard) return guard;

	c.header("Cache-Control", "public, max-age=60");
	return forward_to_pulse(c, { pulse_path: `/summary/${project_id}`, forward_query: true });
});

app.get("/events/:project_id", requireAuth, async c => {
	const project_id = project_param(c);
	if (!project_id) return c.json({ error: "Project ID required" }, 400);

	const guard = await guard_project_owner(c, project_id);
	if (guard) return guard;

	return forward_to_pulse(c, { pulse_path: `/events/${project_id}`, forward_query: true });
});

app.get("/errors/:project_id", requireAuth, async c => {
	const project_id = project_param(c);
	if (!project_id) return c.json({ error: "Project ID required" }, 400);

	const guard = await guard_project_owner(c, project_id);
	if (guard) return guard;

	c.header("Cache-Control", "public, max-age=60");
	return forward_to_pulse(c, { pulse_path: `/errors/${project_id}`, forward_query: true });
});

app.get("/logs/:project_id", requireAuth, async c => {
	const project_id = project_param(c);
	if (!project_id) return c.json({ error: "Project ID required" }, 400);

	const guard = await guard_project_owner(c, project_id);
	if (guard) return guard;

	return forward_to_pulse(c, { pulse_path: `/logs/${project_id}`, forward_query: true });
});

app.get("/latency/:project_id", requireAuth, async c => {
	const project_id = project_param(c);
	if (!project_id) return c.json({ error: "Project ID required" }, 400);

	const guard = await guard_project_owner(c, project_id);
	if (guard) return guard;

	c.header("Cache-Control", "public, max-age=60");
	return forward_to_pulse(c, { pulse_path: `/latency/${project_id}`, forward_query: true });
});

/* ----------------------------------------------------------- subs management */

app.get("/admin/subs", requireAuth, async c => {
	const project_id = c.req.query("project_id");
	if (!project_id) return c.json({ error: "Project ID required" }, 400);

	const guard = await guard_project_owner(c, project_id);
	if (guard) return guard;

	return forward_to_pulse(c, { pulse_path: "/admin/subs", extra_query: { project_id } });
});

app.get("/admin/subs/:id", requireAuth, async c => {
	const user = c.get("user");
	if (!user) return c.json({ error: "Unauthorized" }, 401);

	const id = c.req.param("id");
	return forward_to_pulse(c, { pulse_path: `/admin/subs/${id}` });
});

app.post("/admin/subs", requireAuth, async c => {
	const body = (await c.req.json().catch(() => ({}))) as { project_id?: string };
	const project_id = body.project_id;
	if (!project_id) return c.json({ error: "Project ID required in body" }, 400);

	const guard = await guard_project_owner(c, project_id);
	if (guard) return guard;

	const config = c.get("config");
	if (!config.pulse_api_base || !config.pulse_internal_key) {
		return c.json({ error: "Pulse integration not configured" }, 503);
	}

	let response: Response;
	try {
		response = await fetch(`${config.pulse_api_base}/admin/subs`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${config.pulse_internal_key}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
		});
	} catch {
		return c.json({ error: "pulse_unreachable" }, 503);
	}

	if (response.status === 502 || response.status === 503) return c.json({ error: "pulse_unreachable" }, 503);
	if (response.status === 204) return c.body(null, 204);

	const content_type = response.headers.get("content-type") ?? "";
	if (content_type.includes("application/json")) {
		const data = await response.json();
		return c.json(data as Record<string, unknown>, response.status as 200);
	}
	const text = await response.text();
	return c.text(text, response.status as 200);
});

app.patch("/admin/subs/:id", requireAuth, async c => {
	const user = c.get("user");
	if (!user) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	return forward_to_pulse(c, { pulse_path: `/admin/subs/${id}`, method: "PATCH" });
});

app.delete("/admin/subs/:id", requireAuth, async c => {
	const user = c.get("user");
	if (!user) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	return forward_to_pulse(c, { pulse_path: `/admin/subs/${id}`, method: "DELETE" });
});

/* --------------------------------------------------------- ingest key admin */

app.post("/admin/keys", requireAuth, async c => {
	const body = (await c.req.json().catch(() => ({}))) as { project_id?: string };
	const project_id = body.project_id;
	if (!project_id) return c.json({ error: "Project ID required in body" }, 400);

	const guard = await guard_project_owner(c, project_id);
	if (guard) return guard;

	const config = c.get("config");
	if (!config.pulse_api_base || !config.pulse_internal_key) {
		return c.json({ error: "Pulse integration not configured" }, 503);
	}

	let response: Response;
	try {
		response = await fetch(`${config.pulse_api_base}/admin/keys`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${config.pulse_internal_key}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
		});
	} catch {
		return c.json({ error: "pulse_unreachable" }, 503);
	}

	if (response.status === 502 || response.status === 503) return c.json({ error: "pulse_unreachable" }, 503);
	const content_type = response.headers.get("content-type") ?? "";
	if (content_type.includes("application/json")) {
		const data = await response.json();
		return c.json(data as Record<string, unknown>, response.status as 200);
	}
	const text = await response.text();
	return c.text(text, response.status as 200);
});

app.get("/admin/keys", requireAuth, async c => {
	const project_id = c.req.query("project_id");
	if (!project_id) return c.json({ error: "Project ID required" }, 400);

	const guard = await guard_project_owner(c, project_id);
	if (guard) return guard;

	return forward_to_pulse(c, { pulse_path: "/admin/keys", extra_query: { project_id } });
});

app.delete("/admin/keys/:id", requireAuth, async c => {
	const project_id = c.req.query("project_id");
	if (!project_id) return c.json({ error: "Project ID required in query" }, 400);

	const guard = await guard_project_owner(c, project_id);
	if (guard) return guard;

	const id = c.req.param("id");
	return forward_to_pulse(c, { pulse_path: `/admin/keys/${id}`, method: "DELETE", extra_query: { project_id } });
});

export default app;
