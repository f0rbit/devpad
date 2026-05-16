/**
 * @module pipelines/routes
 *
 * Hono routes for the orchestrator Worker. Each route is a tiny
 * shape adapter:
 *
 * - parse the inbound request with Zod
 * - call into `@devpad/core/services/pipelines` for state-touching
 *   work, OR forward to the run's Durable Object via {@link DoRouter}
 * - serialize the Result into a `{ ok, value | error }` envelope
 *
 * The reads (`GET /runs/:id`) hit D1 directly — the DO state is
 * scheduling/scratch only.
 */

import type { ResolvedPlan } from "@devpad/core/services/pipelines";
import { create_run, get_run, resolve_run_plan } from "@devpad/core/services/pipelines";
import { approve_grant, deny_grant, list_grants } from "@devpad/core/services/pipelines/grants";
import type { PipelineTemplate } from "@devpad/pipeline-templates";
import { pipeline_package } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import type { VersionSetManifest } from "@f0rbit/corpus";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { DoRouter } from "./do-router.ts";

export const create_run_body = z.object({
	package_id: z.string().min(1),
	version_set_id: z.string().min(1),
});

export const approve_body = z.object({
	stage_name: z.string().min(1),
	decision: z.enum(["approved", "denied"]),
	user_id: z.string().min(1),
	reason: z.string().optional(),
});

export const grant_approve_body = z.object({
	user_id: z.string().min(1),
});

export const grant_deny_body = z.object({
	user_id: z.string().min(1),
	reason: z.string().optional(),
});

export interface ManifestProvider {
	get(version_set_id: string): Promise<VersionSetManifest | null>;
}

export interface TemplateResolver {
	resolve(package_id: string): Promise<PipelineTemplate | null>;
}

export interface LineageProvider {
	previous(package_id: string, version_set_id: string): Promise<string | null>;
}

export type RoutesDeps = {
	db: Database;
	do_router: DoRouter;
	manifests: ManifestProvider;
	templates: TemplateResolver;
	lineage: LineageProvider;
};

type AppCtx = { Variables: { deps: RoutesDeps } };

const json_err = (status: number, error: unknown) =>
	new Response(JSON.stringify({ ok: false, error }), {
		status,
		headers: { "content-type": "application/json" },
	});

const json_ok = <T>(value: T) =>
	new Response(JSON.stringify({ ok: true, value }), {
		status: 200,
		headers: { "content-type": "application/json" },
	});

const do_call = async (deps: RoutesDeps, run_id: string, action: string, body: unknown): Promise<Response> => {
	const stub = deps.do_router.get(run_id);
	const req = new Request(`https://run.local/${action}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	return stub.fetch(req);
};

export const make_routes = (deps_factory: (env: unknown) => RoutesDeps) => {
	const app = new Hono<AppCtx>();

	app.use("*", async (c, next) => {
		const deps = deps_factory(c.env);
		c.set("deps", deps);
		await next();
	});

	app.post("/runs", async c => {
		const body = await c.req.json().catch(() => null);
		const parsed = create_run_body.safeParse(body);
		if (!parsed.success) return json_err(400, { code: "invalid_body", issues: parsed.error.issues });
		const deps = c.get("deps");
		const package_row = (await deps.db.select().from(pipeline_package).where(eq(pipeline_package.id, parsed.data.package_id)))[0];
		if (package_row === undefined) return json_err(404, { code: "not_found", resource: "pipeline_package", id: parsed.data.package_id });

		const template = await deps.templates.resolve(parsed.data.package_id);
		if (template === null) return json_err(404, { code: "not_found", resource: "pipeline_template", id: parsed.data.package_id });

		const manifest = await deps.manifests.get(parsed.data.version_set_id);
		if (manifest === null) return json_err(404, { code: "not_found", resource: "version_set_manifest", id: parsed.data.version_set_id });

		const previous_version_set_id = await deps.lineage.previous(parsed.data.package_id, parsed.data.version_set_id);

		const created = await create_run(deps.db, {
			package_id: parsed.data.package_id,
			template,
			manifest,
			version_set_id: parsed.data.version_set_id,
			previous_version_set_id,
		});
		if (!created.ok) return json_err(500, created.error);

		const { run, plan } = created.value;
		const advance_res = await do_call(deps, run.id, "advance", { plan });
		const advance_body = await advance_res.json().catch(() => null);
		if (advance_res.status >= 400) return json_err(advance_res.status, advance_body);

		return json_ok({ run_id: run.id, status: run.status, plan, advance: advance_body });
	});

	app.get("/runs/:id", async c => {
		const deps = c.get("deps");
		const run = await get_run(deps.db, c.req.param("id"));
		if (!run.ok) return json_err(run.error.kind === "not_found" ? 404 : 500, run.error);
		return json_ok(run.value);
	});

	app.post("/runs/:id/approve", async c => {
		const body = await c.req.json().catch(() => null);
		const parsed = approve_body.safeParse(body);
		if (!parsed.success) return json_err(400, { code: "invalid_body", issues: parsed.error.issues });
		const deps = c.get("deps");
		const run_id = c.req.param("id");

		// We need the plan for the DO call — read it from D1 (resolved_rollout + resolved_gates).
		const run = await get_run(deps.db, run_id);
		if (!run.ok) return json_err(run.error.kind === "not_found" ? 404 : 500, run.error);

		// Reconstruct the plan from the snapshot stored on the run row.
		// (The DO has the plan too, but we keep this read self-contained
		// so the route works even if the DO storage is cold.)
		const plan = await reconstruct_plan(deps, run.value.package_id, run.value.version_set_id);
		if (plan === null) return json_err(500, { code: "plan_unavailable", run_id });

		const response = await do_call(deps, run_id, "approve", { ...parsed.data, plan });
		return passthrough(response);
	});

	app.post("/runs/:id/cancel", async c => {
		const deps = c.get("deps");
		const run_id = c.req.param("id");
		const run = await get_run(deps.db, run_id);
		if (!run.ok) return json_err(run.error.kind === "not_found" ? 404 : 500, run.error);
		const plan = await reconstruct_plan(deps, run.value.package_id, run.value.version_set_id);
		if (plan === null) return json_err(500, { code: "plan_unavailable", run_id });
		const response = await do_call(deps, run_id, "cancel", { plan });
		return passthrough(response);
	});

	app.post("/runs/:id/rollback", async c => {
		const deps = c.get("deps");
		const run_id = c.req.param("id");
		const run = await get_run(deps.db, run_id);
		if (!run.ok) return json_err(run.error.kind === "not_found" ? 404 : 500, run.error);
		const plan = await reconstruct_plan(deps, run.value.package_id, run.value.version_set_id);
		if (plan === null) return json_err(500, { code: "plan_unavailable", run_id });
		const response = await do_call(deps, run_id, "rollback", { plan });
		return passthrough(response);
	});

	app.get("/grants", async c => {
		const deps = c.get("deps");
		const package_id = c.req.query("package_id");
		if (!package_id) return json_err(400, { code: "missing_param", param: "package_id" });

		const grants_result = await list_grants(deps.db, package_id);
		if (!grants_result.ok) return json_err(500, grants_result.error);
		return json_ok(grants_result.value);
	});

	app.post("/grants/:id/approve", async c => {
		const deps = c.get("deps");
		const body = await c.req.json().catch(() => null);
		const parsed = grant_approve_body.safeParse(body);
		if (!parsed.success) return json_err(400, { code: "invalid_body", issues: parsed.error.issues });

		const grant_id = c.req.param("id");
		const result = await approve_grant(deps.db, grant_id, parsed.data.user_id);
		if (!result.ok) return json_err(result.error.kind === "not_found" ? 404 : 500, result.error);
		return json_ok(result.value);
	});

	app.post("/grants/:id/deny", async c => {
		const deps = c.get("deps");
		const body = await c.req.json().catch(() => null);
		const parsed = grant_deny_body.safeParse(body);
		if (!parsed.success) return json_err(400, { code: "invalid_body", issues: parsed.error.issues });

		const grant_id = c.req.param("id");
		const result = await deny_grant(deps.db, grant_id, parsed.data.user_id, parsed.data.reason);
		if (!result.ok) return json_err(result.error.kind === "not_found" ? 404 : 500, result.error);
		return json_ok({ success: true });
	});

	app.get("/health", c => c.json({ status: "ok", timestamp: new Date().toISOString() }));

	return app;
};

const passthrough = async (response: Response): Promise<Response> => {
	const body = await response.text();
	return new Response(body, { status: response.status, headers: { "content-type": "application/json" } });
};

/**
 * Rebuild the ResolvedPlan that the DO needs.
 *
 * The `pipeline_run` row already carries `resolved_rollout` +
 * `resolved_gates` JSON, but the state machine needs the typed
 * `Stage[]` + `Gate` map. The cleanest path is to re-run
 * `resolve_run_plan` from the template + manifest — both of which
 * are available via the resolver/manifest providers.
 *
 * Phase 2 can collapse this into reading the snapshot directly off
 * the row.
 */
const reconstruct_plan = async (deps: RoutesDeps, package_id: string, version_set_id: string): Promise<ResolvedPlan | null> => {
	const template = await deps.templates.resolve(package_id);
	if (template === null) return null;
	const manifest = await deps.manifests.get(version_set_id);
	if (manifest === null) return null;
	const previous_version_set_id = await deps.lineage.previous(package_id, version_set_id);
	return resolve_run_plan({ template, manifest, version_set_id, previous_version_set_id });
};
