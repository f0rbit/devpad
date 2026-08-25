import { docs, projects } from "@devpad/core/services";
import {
	create_thread_request,
	push_doc_request,
	push_interface_report_request,
	reply_thread_request,
	toggle_blocking_request,
} from "@devpad/schema/validation";
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
	// v2.4 (task A4.2) — `push_document_annotated` reconciles any markers the
	// pushed HTML already carries (re-anchor or orphan) before sanitizing +
	// pushing; a no-op superset of the plain sanitize for a marker-free doc.
	const result = await docs.push_document_annotated(db, backend_guard.backend, data, auth_channel);
	if (!result.ok) {
		if (result.error.kind === "not_found")
			return c.json({ error: `Document ${data.document_id ?? ""} not found` }, 404);
		if (result.error.kind === "bad_request") return c.json({ error: result.error.message }, 400);
		if (result.error.kind === "invalid_content") return c.json({ error: result.error.message }, 400);
		return c.json({ error: result.error.kind }, 500);
	}
	return c.json(result.value);
});

app.get("/annotations/unresolved", requireAuth, async (c) => {
	const db = c.get("db");
	const project_id = c.req.query("project_id");
	const document_id = c.req.query("document_id");

	if (document_id) {
		const doc_result = await docs.get_document(db, document_id);
		if (!doc_result.ok) return c.json(null, 404);
		const guard = await assertProjectOwnership(c, doc_result.value.project_id);
		if (!guard.ok) return guard.response;
	} else if (project_id) {
		const guard = await assertProjectOwnership(c, project_id);
		if (!guard.ok) return guard.response;
	} else {
		return c.json({ error: "project_id or document_id required" }, 400);
	}

	const result = await docs.list_unresolved(db, { document_id });
	if (!result.ok) return c.json({ error: result.error.kind }, 500);
	// Scope to the requested project when no specific document was given —
	// list_unresolved has no project filter of its own (annotation_thread
	// doesn't carry project_id directly).
	if (!document_id && project_id) {
		const owned = await docs.list_documents(db, { project_id });
		if (!owned.ok) return c.json({ error: owned.error.kind }, 500);
		const owned_ids = new Set(owned.value.map((d) => d.id));
		return c.json(result.value.filter((t) => owned_ids.has(t.document_id)));
	}
	return c.json(result.value);
});

app.post("/interface", requireAuth, zValidator("json", push_interface_report_request), async (c) => {
	const db = c.get("db");
	const data = c.req.valid("json");

	const guard = await assertProjectOwnership(c, data.project_id);
	if (!guard.ok) return guard.response;

	const backend_guard = requireDocsBackend(c);
	if (!backend_guard.ok) return backend_guard.response;

	const auth_channel = c.get("auth_channel");
	const result = await docs.push_interface_report(db, backend_guard.backend, data, { auth_channel });
	if (!result.ok) {
		if (result.error.kind === "not_found")
			return c.json({ error: `Document ${data.document_id ?? ""} not found` }, 404);
		if (result.error.kind === "bad_request") return c.json({ error: result.error.message }, 400);
		return c.json({ error: result.error.kind }, 500);
	}
	return c.json(result.value);
});

/** `check`'s counterpart to `push` — the approved/auto base's content_hash, if one exists, for a document identified by (project, task, title). */
app.get("/interface/status", requireAuth, async (c) => {
	const db = c.get("db");
	const project_id = c.req.query("project_id");
	const task_id = c.req.query("task_id");
	const title = c.req.query("title");
	if (!project_id || !title) return c.json({ error: "project_id and title required" }, 400);

	const guard = await assertProjectOwnership(c, project_id);
	if (!guard.ok) return guard.response;

	const listed = await docs.list_documents(db, { project_id, task_id });
	if (!listed.ok) return c.json({ error: listed.error.kind }, 500);
	const document = listed.value.find((d) => d.kind === "interface" && d.title === title);
	if (!document) return c.json({ document_id: null, approved_content_hash: null });

	const latest = await docs.latest_decided_signoff(db, "doc_version", document.id, "types");
	if (!latest.ok) return c.json({ error: latest.error.kind }, 500);
	return c.json({ document_id: document.id, approved_content_hash: latest.value?.content_hash ?? null });
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

	if (!doc_result.value.head_version) {
		return c.json({ document: doc_result.value, content: null, threads: [], orphaned: [] });
	}

	const content_result = await docs.get_version(backend_guard.backend, id, version);
	if (!content_result.ok) {
		if (content_result.error.kind === "not_found") return c.json(null, 404);
		return c.json({ error: content_result.error.kind }, 500);
	}
	const { threads, orphans } = docs.parse_markers(content_result.value.html);
	return c.json({
		document: doc_result.value,
		content: content_result.value,
		threads: threads.map((t) => t.marker),
		orphaned: orphans.flatMap((o) => (o.marker ? [o.marker] : [])),
	});
});

/**
 * v2.4 (B3.1) — the DocViewer's render surface: a STANDALONE HTML document
 * (not JSON) the viewer loads into a sandboxed, script-disabled iframe.
 * Defense in depth over sanitize-on-push (gap 7): even if a future ingest
 * gap ever let something hostile through, this response's own CSP has no
 * `script-src`/`connect-src`/`frame-src` at all, so nothing it could embed
 * can execute or phone home — independent of whatever the DOM sanitizer did.
 *
 * v2.4 (B3 fast-follow #4, taste/IA critic — "anchor connection") — paired
 * marker comments are converted to `<mark data-thread-id>` spans (not just
 * stripped) so the annotation rail has a DOM hook to scroll/flash a thread's
 * anchored text against. The annotation engine's own anchor math always
 * operates on the corpus-stored content directly, never on this render.
 */
app.get("/:id/render", requireAuth, async (c) => {
	const db = c.get("db");
	const id = c.req.param("id");
	const version = c.req.query("version");

	const doc_result = await docs.get_document(db, id);
	if (!doc_result.ok) return c.text("Not found", 404);
	const guard = await assertProjectOwnership(c, doc_result.value.project_id);
	if (!guard.ok) return guard.response;

	const backend_guard = requireDocsBackend(c);
	if (!backend_guard.ok) return c.text("Docs corpus backend not configured", 503);

	if (!doc_result.value.head_version) return c.text("", 200);

	const content_result = await docs.get_version(backend_guard.backend, id, version);
	if (!content_result.ok) return c.text("Not found", 404);

	const marked = docs.markers_to_marks(content_result.value.html);
	// v2.4 (B3 fast-follow #8) — `interface` docs are pushed as escaped plain
	// text (see `signoff.ts`'s `push_interface_report`), so without
	// `pre-wrap` a multi-line declaration list collapses to one unreadable
	// line; other kinds keep normal HTML flow.
	const white_space = doc_result.value.kind === "interface" ? "white-space:pre-wrap;" : "";
	const body_style = `body{font:14px/1.6 system-ui,sans-serif;color:#1a1a1a;margin:16px;overflow-wrap:anywhere;${white_space}}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}mark{background:#fff3a3;color:inherit}mark.mark-flash{background:#ffd23f}`;
	const body = `<!doctype html><html><head><meta charset="utf-8"><style>${body_style}</style></head><body>${marked}</body></html>`;

	c.header(
		"Content-Security-Policy",
		"default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; frame-ancestors 'self'",
	);
	c.header("X-Content-Type-Options", "nosniff");
	return c.html(body);
});

app.post("/:id/threads", requireAuth, zValidator("json", create_thread_request), async (c) => {
	const db = c.get("db");
	const auth_user = c.get("user");
	if (!auth_user) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	const data = c.req.valid("json");

	const doc_result = await docs.get_document(db, id);
	if (!doc_result.ok) return c.json(null, 404);
	const guard = await assertProjectOwnership(c, doc_result.value.project_id);
	if (!guard.ok) return guard.response;

	const backend_guard = requireDocsBackend(c);
	if (!backend_guard.ok) return backend_guard.response;

	const auth_channel = c.get("auth_channel");
	const result = await docs.create_thread(db, backend_guard.backend, id, data, {
		author: auth_user.id,
		channel: auth_channel,
	});
	if (!result.ok) {
		if (result.error.kind === "bad_request") return c.json({ error: result.error.message }, 400);
		return c.json({ error: result.error.kind }, 500);
	}
	return c.json(result.value);
});

app.post("/:id/threads/:thread_id/reply", requireAuth, zValidator("json", reply_thread_request), async (c) => {
	const db = c.get("db");
	const auth_user = c.get("user");
	if (!auth_user) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	const thread_id = c.req.param("thread_id");
	const data = c.req.valid("json");

	const doc_result = await docs.get_document(db, id);
	if (!doc_result.ok) return c.json(null, 404);
	const guard = await assertProjectOwnership(c, doc_result.value.project_id);
	if (!guard.ok) return guard.response;

	const backend_guard = requireDocsBackend(c);
	if (!backend_guard.ok) return backend_guard.response;

	const auth_channel = c.get("auth_channel");
	const result = await docs.reply_thread(db, backend_guard.backend, id, thread_id, data.body, {
		author: auth_user.id,
		channel: auth_channel,
	});
	if (!result.ok) {
		if (result.error.kind === "not_found") return c.json({ error: `Thread ${thread_id} not found` }, 404);
		return c.json({ error: result.error.kind }, 500);
	}
	return c.json(result.value);
});

app.post("/:id/threads/:thread_id/resolve", requireAuth, async (c) => {
	const db = c.get("db");
	const auth_user = c.get("user");
	if (!auth_user) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	const thread_id = c.req.param("thread_id");

	const doc_result = await docs.get_document(db, id);
	if (!doc_result.ok) return c.json(null, 404);
	const guard = await assertProjectOwnership(c, doc_result.value.project_id);
	if (!guard.ok) return guard.response;

	const backend_guard = requireDocsBackend(c);
	if (!backend_guard.ok) return backend_guard.response;

	const auth_channel = c.get("auth_channel");
	const result = await docs.resolve_thread(db, backend_guard.backend, id, thread_id, {
		author: auth_user.id,
		channel: auth_channel,
	});
	if (!result.ok) {
		if (result.error.kind === "not_found") return c.json({ error: `Thread ${thread_id} not found` }, 404);
		return c.json({ error: result.error.kind }, 500);
	}
	return c.json(result.value);
});

app.post("/:id/threads/:thread_id/blocking", requireAuth, zValidator("json", toggle_blocking_request), async (c) => {
	const db = c.get("db");
	const auth_user = c.get("user");
	if (!auth_user) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	const thread_id = c.req.param("thread_id");
	const data = c.req.valid("json");

	const doc_result = await docs.get_document(db, id);
	if (!doc_result.ok) return c.json(null, 404);
	const guard = await assertProjectOwnership(c, doc_result.value.project_id);
	if (!guard.ok) return guard.response;

	const backend_guard = requireDocsBackend(c);
	if (!backend_guard.ok) return backend_guard.response;

	const auth_channel = c.get("auth_channel");
	const result = await docs.toggle_blocking(db, backend_guard.backend, id, thread_id, data.blocking, {
		author: auth_user.id,
		channel: auth_channel,
	});
	if (!result.ok) {
		if (result.error.kind === "not_found") return c.json({ error: `Thread ${thread_id} not found` }, 404);
		return c.json({ error: result.error.kind }, 500);
	}
	return c.json(result.value);
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
