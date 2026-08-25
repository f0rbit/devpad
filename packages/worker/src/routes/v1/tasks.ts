import { action, docs, graph, hooks, tags, tasks } from "@devpad/core/services";
import {
	advance_stage_request,
	type ApplyOp,
	apply_request,
	claim_request,
	done_request,
	save_tags_request,
	type UpsertTag,
	upsert_task_link,
	upsert_todo,
} from "@devpad/schema";
import { GRAPH_DEPTH_CAP } from "@devpad/schema/database/schema";
import { tag, task, task_link } from "@devpad/schema/database";
import { zValidator } from "@hono/zod-validator";
import { eq, inArray } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import type { AppContext } from "../../bindings.js";
import { requireAuth } from "../../middleware/auth.js";
import { isProjectScopeDenied, projectScopeDeniedResponse } from "../../middleware/scope-guard.js";

const app = new Hono<AppContext>();

const READY_DEFAULT_LIMIT = 20;
const READY_MAX_LIMIT = 100;

/** Maps a GraphError to the right HTTP status + body shape — shared across every graph-mutating route. */
function graph_error_response(c: Context<AppContext>, error: { kind: string; message?: string; [k: string]: unknown }) {
	if (error.kind === "graph_conflict") return c.json({ error: error.message, current: error.current }, 409);
	if (error.kind === "cycle_detected" || error.kind === "depth_exceeded" || error.kind === "children_cap_exceeded") {
		return c.json({ error: error.message }, 422);
	}
	if (error.kind === "not_found") return c.json(null, 404);
	if (error.kind === "forbidden") return c.json({ error: error.message }, 401);
	// v2.4 (task A4.3) — approval-kind tasks are human-only completable.
	if (error.kind === "approval_channel") return c.json({ error: error.message, task_id: error.task_id }, 403);
	return c.json({ error: error.kind }, 500);
}

const is_handle = (v: string) => v.startsWith("$");

/** Concrete (non-`$N`-handle) task ids referenced anywhere in an apply batch — used to pre-flight ownership. */
function referenced_task_ids(ops: ApplyOp[]): string[] {
	const ids: string[] = [];
	for (const op of ops) {
		if (op.op === "create") continue;
		if (op.op === "link") {
			if (!is_handle(op.link.src_id)) ids.push(op.link.src_id);
			if (op.link.dst_id && !is_handle(op.link.dst_id)) ids.push(op.link.dst_id);
			continue;
		}
		if (!is_handle(op.id)) ids.push(op.id);
		if (op.op === "reparent" && op.parent_id && !is_handle(op.parent_id)) ids.push(op.parent_id);
	}
	return ids;
}

app.get("/", requireAuth, async (c) => {
	const db = c.get("db");
	const auth_user = c.get("user");
	if (!auth_user) return c.json({ error: "Unauthorized" }, 401);
	const query = c.req.query();

	if (query.id) {
		const result = await tasks.getTask(db, query.id);
		if (!result.ok) return c.json({ error: result.error.kind }, 500);
		if (!result.value) return c.json(null, 404);
		if (result.value.task.owner_id !== auth_user.id) return c.json(null, 401);
		if (isProjectScopeDenied(c, result.value.task.project_id)) return projectScopeDeniedResponse(c);
		return c.json(result.value);
	}

	if (query.tag) {
		const result = await tasks.getTasksByTag(db, query.tag);
		if (!result.ok) return c.json({ error: result.error.kind }, 500);
		return c.json(result.value);
	}

	if (query.project) {
		const result = await tasks.getProjectTasks(db, query.project);
		if (!result.ok) return c.json({ error: result.error.kind }, 500);
		return c.json(result.value);
	}

	const result = await tasks.getUserTasks(db, auth_user.id);
	if (!result.ok) return c.json({ error: result.error.kind }, 500);
	return c.json(result.value);
});

app.get("/history/:task_id", requireAuth, async (c) => {
	const db = c.get("db");
	const auth_user = c.get("user");
	if (!auth_user) return c.json({ error: "Unauthorized" }, 401);
	const task_id = c.req.param("task_id");

	if (!task_id) return c.json({ error: "Missing task_id parameter" }, 400);

	const task_result = await tasks.getTask(db, task_id);
	if (!task_result.ok) return c.json({ error: task_result.error.kind }, 500);
	if (!task_result.value) return c.json(null, 404);
	if (task_result.value.task.owner_id !== auth_user.id) return c.json({ error: "Unauthorized" }, 401);
	if (isProjectScopeDenied(c, task_result.value.task.project_id)) return projectScopeDeniedResponse(c);

	const result = await action.getTaskHistory(db, task_id);
	if (!result.ok) return c.json({ error: result.error.kind }, 500);
	return c.json(result.value);
});

app.patch("/", requireAuth, zValidator("json", upsert_todo), async (c) => {
	const db = c.get("db");
	const auth_user = c.get("user");
	if (!auth_user) return c.json({ error: "Unauthorized" }, 401);
	const data = c.req.valid("json");
	const body = await c.req.json();

	if (data.owner_id !== auth_user.id) {
		return c.json({ error: "Unauthorized: owner_id mismatch" }, 401);
	}
	if (isProjectScopeDenied(c, data.project_id ?? null)) return projectScopeDeniedResponse(c);

	let tag_list: UpsertTag[] = [];
	if (body.tags) {
		const tag_parse = save_tags_request.safeParse(body.tags);
		if (!tag_parse.success) return c.json({ error: tag_parse.error.message }, 400);
		tag_list = tag_parse.data;
	}

	const auth_channel = c.get("auth_channel");
	const result = await tasks.upsertTask(db, data, tag_list, auth_user.id, auth_channel);
	if (!result.ok) {
		if (result.error.kind === "forbidden") return c.json({ error: result.error.message }, 401);
		if (result.error.kind === "protected")
			return c.json(
				{
					error: result.error.message,
					entity_id: result.error.entity_id,
					modified_by: result.error.modified_by,
					modified_at: result.error.modified_at,
				},
				409,
			);
		if (result.error.kind === "bad_request") return c.json({ error: result.error.message }, 400);
		// v2.4 (task A4.3) — a fresh-complete on an approval-kind task routes
		// through the same engine as `/done`; approval_channel is 403 here too.
		if (result.error.kind === "approval_channel") {
			return c.json({ error: result.error.message, task_id: result.error.task_id }, 403);
		}
		return c.json({ error: result.error.kind }, 500);
	}
	return c.json(result.value);
});

app.patch("/save_tags", requireAuth, zValidator("json", save_tags_request), async (c) => {
	const db = c.get("db");
	const auth_user = c.get("user");
	if (!auth_user) return c.json({ error: "Unauthorized" }, 401);
	const data = c.req.valid("json");

	for (const t of data) {
		if (t.owner_id && t.owner_id !== auth_user.id) {
			return c.json({ error: "Unauthorized: owner_id mismatch" }, 401);
		}
	}

	const results = await Promise.all(data.map((t) => tags.upsertTag(db, t)));
	const failed = results.find((r) => !r.ok);
	if (failed) return c.json({ error: "Error saving tags" }, 500);

	const tag_ids = results.filter((r) => r.ok).map((r) => r.value);
	if (tag_ids.length !== data.length) return c.json({ error: "Tag upsert returned incorrect rows" }, 500);

	const full_tags = await db.select().from(tag).where(inArray(tag.id, tag_ids));
	return c.json(full_tags);
});

app.get("/ready", requireAuth, async (c) => {
	const db = c.get("db");
	const auth_user = c.get("user");
	if (!auth_user) return c.json({ error: "Unauthorized" }, 401);
	const query = c.req.query();

	const parsed_limit = Number(query.limit);
	const limit =
		Number.isFinite(parsed_limit) && parsed_limit > 0 ? Math.min(parsed_limit, READY_MAX_LIMIT) : READY_DEFAULT_LIMIT;

	const result = await graph.ready(db, {
		owner_id: auth_user.id,
		project_id: query.project,
		limit,
		cursor: query.cursor,
	});
	if (!result.ok) return c.json({ error: result.error.kind }, 500);
	return c.json(result.value);
});

app.get("/:id/tree", requireAuth, async (c) => {
	const db = c.get("db");
	const auth_user = c.get("user");
	if (!auth_user) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");

	const root_result = await tasks.getTask(db, id);
	if (!root_result.ok) return c.json({ error: root_result.error.kind }, 500);
	if (!root_result.value) return c.json(null, 404);
	if (root_result.value.task.owner_id !== auth_user.id) return c.json(null, 401);
	if (isProjectScopeDenied(c, root_result.value.task.project_id)) return projectScopeDeniedResponse(c);

	const parsed_depth = Number(c.req.query("depth"));
	const depth =
		Number.isFinite(parsed_depth) && parsed_depth > 0 ? Math.min(parsed_depth, GRAPH_DEPTH_CAP) : GRAPH_DEPTH_CAP;

	const result = await graph.subtree(db, id, depth);
	if (!result.ok) return c.json({ error: result.error.kind }, 500);

	const all_ids = [id, ...result.value.map((t) => t.id)];
	const rollups_result = await graph.rollups_for(db, all_ids);
	if (!rollups_result.ok) return c.json({ error: rollups_result.error.kind }, 500);

	const edge_summary_result = await graph.edge_summary_for(db, all_ids);
	if (!edge_summary_result.ok) return c.json({ error: edge_summary_result.error.kind }, 500);

	return c.json({
		task: root_result.value.task,
		descendants: result.value,
		rollups: rollups_result.value,
		edge_summary: edge_summary_result.value,
	});
});

/** Immediate-parent-first ancestor chain — powers the outline's zoom breadcrumbs (v2.4, task B1.3). */
app.get("/:id/ancestors", requireAuth, async (c) => {
	const db = c.get("db");
	const auth_user = c.get("user");
	if (!auth_user) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");

	const root_result = await tasks.getTask(db, id);
	if (!root_result.ok) return c.json({ error: root_result.error.kind }, 500);
	if (!root_result.value) return c.json(null, 404);
	if (root_result.value.task.owner_id !== auth_user.id) return c.json(null, 401);
	if (isProjectScopeDenied(c, root_result.value.task.project_id)) return projectScopeDeniedResponse(c);

	const result = await graph.ancestors(db, id);
	if (!result.ok) return c.json({ error: result.error.kind }, 500);
	return c.json(result.value);
});

app.get("/:id/near", requireAuth, async (c) => {
	const db = c.get("db");
	const auth_user = c.get("user");
	if (!auth_user) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");

	const root_result = await tasks.getTask(db, id);
	if (!root_result.ok) return c.json({ error: root_result.error.kind }, 500);
	if (!root_result.value) return c.json(null, 404);
	if (root_result.value.task.owner_id !== auth_user.id) return c.json(null, 401);
	if (isProjectScopeDenied(c, root_result.value.task.project_id)) return projectScopeDeniedResponse(c);

	const result = await graph.near(db, id);
	if (!result.ok) return c.json({ error: result.error.kind }, 500);
	return c.json(result.value);
});

app.post("/:id/claim", requireAuth, zValidator("json", claim_request), async (c) => {
	const db = c.get("db");
	const auth_user = c.get("user");
	if (!auth_user) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	const data = c.req.valid("json");

	const existing = await tasks.getTask(db, id);
	if (!existing.ok) return c.json({ error: existing.error.kind }, 500);
	if (!existing.value) return c.json(null, 404);
	if (existing.value.task.owner_id !== auth_user.id) return c.json(null, 401);
	if (isProjectScopeDenied(c, existing.value.task.project_id)) return projectScopeDeniedResponse(c);

	const result = await graph.claim(db, { id, actor: data.actor, base_rev: data.base_rev });
	if (!result.ok) return graph_error_response(c, result.error);
	return c.json(result.value);
});

/**
 * The single completion entrypoint (task A2.6) — every other completion
 * path (upsertTask's progress:"COMPLETED", the MCP tool, the CLI) either
 * calls SqlCompletionEngine directly or routes through this same endpoint.
 * `hooks_fired` is a placeholder until phase A3 wires real hook dispatch.
 */
app.post("/:id/done", requireAuth, zValidator("json", done_request), async (c) => {
	const db = c.get("db");
	const auth_user = c.get("user");
	if (!auth_user) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	const data = c.req.valid("json");

	const existing = await tasks.getTask(db, id);
	if (!existing.ok) return c.json({ error: existing.error.kind }, 500);
	if (!existing.value) return c.json(null, 404);
	if (existing.value.task.owner_id !== auth_user.id) return c.json(null, 401);
	if (isProjectScopeDenied(c, existing.value.task.project_id)) return projectScopeDeniedResponse(c);

	const auth_channel = c.get("auth_channel");
	const engine = new graph.SqlCompletionEngine(db);
	const result = await engine.complete(id, auth_channel, data.base_rev);
	if (!result.ok) return graph_error_response(c, result.error);

	// v2.4 (task A3.4) — force an immediate dispatch attempt for exactly the
	// events this completion emitted, then report whichever finished
	// synchronously. See `hooks.hooks_fired_for`'s doc for why this is
	// best-effort, not a delivery guarantee.
	const event_ids = result.value.events.map((event) => event.event_id);
	const dispatch = c.get("dispatch");
	if (dispatch) await Promise.all(event_ids.map((event_id) => dispatch.send({ event_id })));
	const fired = await hooks.hooks_fired_for(db, event_ids);
	const hooks_fired = fired.ok ? fired.value : [];

	return c.json({ completed: result.value.completed, bubbled: result.value.bubbled, hooks_fired });
});

/**
 * v2.4 (task A4.5) — SDLC stage transitions. Gently enforced: a gated hop
 * missing its checkpoint is a 409 naming what's missing; `override: true`
 * always succeeds but audits (see `docs.advance`).
 */
app.post("/:id/stage", requireAuth, zValidator("json", advance_stage_request), async (c) => {
	const db = c.get("db");
	const auth_user = c.get("user");
	if (!auth_user) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	const data = c.req.valid("json");

	const existing = await tasks.getTask(db, id);
	if (!existing.ok) return c.json({ error: existing.error.kind }, 500);
	if (!existing.value) return c.json(null, 404);
	if (existing.value.task.owner_id !== auth_user.id) return c.json(null, 401);
	if (isProjectScopeDenied(c, existing.value.task.project_id)) return projectScopeDeniedResponse(c);

	const auth_channel = c.get("auth_channel");
	const result = await docs.advance(db, id, data.to, {
		actor: auth_channel,
		override: data.override,
		reason: data.reason,
	});
	if (!result.ok) {
		if (result.error.kind === "not_found") return c.json(null, 404);
		if (result.error.kind === "conflict") return c.json({ error: result.error.message }, 409);
		return c.json({ error: result.error.kind }, 500);
	}
	return c.json(result.value);
});

app.post("/link", requireAuth, zValidator("json", upsert_task_link), async (c) => {
	const db = c.get("db");
	const auth_user = c.get("user");
	if (!auth_user) return c.json({ error: "Unauthorized" }, 401);
	const data = c.req.valid("json");

	const src = await tasks.getTask(db, data.src_id);
	if (!src.ok) return c.json({ error: src.error.kind }, 500);
	if (!src.value || src.value.task.owner_id !== auth_user.id) return c.json(null, 401);
	if (isProjectScopeDenied(c, src.value.task.project_id)) return projectScopeDeniedResponse(c);

	const result = await graph.add_link(db, data);
	if (!result.ok) return graph_error_response(c, result.error);
	return c.json(result.value);
});

app.delete("/link/:id", requireAuth, async (c) => {
	const db = c.get("db");
	const auth_user = c.get("user");
	if (!auth_user) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");

	const link_rows = await db.select().from(task_link).where(eq(task_link.id, id));
	if (link_rows.length === 0) return c.json(null, 404);
	const link = link_rows[0];

	const src = await tasks.getTask(db, link.src_id);
	if (!src.ok || !src.value || src.value.task.owner_id !== auth_user.id) return c.json(null, 401);
	if (isProjectScopeDenied(c, src.value.task.project_id)) return projectScopeDeniedResponse(c);

	const result = await graph.remove_link(db, id);
	if (!result.ok) return graph_error_response(c, result.error);
	return c.json({ success: true });
});

app.post("/apply", requireAuth, zValidator("json", apply_request), async (c) => {
	const db = c.get("db");
	const auth_user = c.get("user");
	if (!auth_user) return c.json({ error: "Unauthorized" }, 401);
	const data = c.req.valid("json");

	const ids = referenced_task_ids(data.ops);
	if (ids.length > 0) {
		const rows = await db
			.select({ id: task.id, owner_id: task.owner_id, project_id: task.project_id })
			.from(task)
			.where(inArray(task.id, ids));
		const foreign = rows.find((r) => r.owner_id !== auth_user.id);
		if (foreign) return c.json({ error: "Unauthorized: task belongs to another owner" }, 401);
		const out_of_scope = rows.find((r) => isProjectScopeDenied(c, r.project_id));
		if (out_of_scope) return projectScopeDeniedResponse(c);
	}
	const creates_out_of_scope = data.ops.some(
		(op) => op.op === "create" && isProjectScopeDenied(c, op.data.project_id ?? null),
	);
	if (creates_out_of_scope) return projectScopeDeniedResponse(c);

	const result = await graph.apply(db, data, { owner_id: auth_user.id });
	if (!result.ok) {
		if (result.error.kind === "apply_op_failed") {
			// v2.4 (task A4.3) — an approval-kind task's guard failing inside a
			// batch is a 403 (human-only), not a generic 409 op conflict.
			if (result.error.error.kind === "approval_channel") {
				return c.json({ error: result.error.error.message, task_id: result.error.error.task_id }, 403);
			}
			return c.json(
				{ error: result.error.error.kind, op_index: result.error.op_index, details: result.error.error },
				409,
			);
		}
		return graph_error_response(c, result.error);
	}
	return c.json(result.value);
});

export default app;
