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
import { create_run, get_run, list_runs, resolve_run_plan } from "@devpad/core/services/pipelines";
import { approve_grant, deny_grant, list_grants } from "@devpad/core/services/pipelines/grants";
import type { PipelineTemplate } from "@devpad/pipeline-templates";
import { pipeline_package, RUN_STATUSES, type RunStatus } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import type { Backend, Result, VersionSetManifest } from "@f0rbit/corpus";
import { err, ok, VersionSetManifestSchema, version_set_store } from "@f0rbit/corpus";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { AuthError } from "./auth.ts";
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

/**
 * Query-param parser for `GET /runs`. `limit` defaults to 50, capped at
 * 200. Unknown statuses fail with a typed error so the catalog UI can
 * surface the invalid value clearly.
 */
const LIST_RUNS_MAX_LIMIT = 200;
const LIST_RUNS_DEFAULT_LIMIT = 50;

const list_runs_query = z.object({
	package_id: z.string().min(1).optional(),
	status: z.enum(RUN_STATUSES).optional(),
	limit: z.coerce.number().int().positive().max(LIST_RUNS_MAX_LIMIT).optional(),
});

type ListRunsParsed = { package_id?: string; status?: RunStatus; limit: number };
type QueryParseError = { code: "invalid_query"; issues: unknown };

const parse_list_runs_query = (raw: Record<string, string>): Result<ListRunsParsed, QueryParseError> => {
	const parsed = list_runs_query.safeParse(raw);
	if (!parsed.success) return err({ code: "invalid_query", issues: parsed.error.issues });
	return ok({ package_id: parsed.data.package_id, status: parsed.data.status, limit: parsed.data.limit ?? LIST_RUNS_DEFAULT_LIMIT });
};

export interface ManifestProvider {
	get(version_set_id: string): Promise<VersionSetManifest | null>;
}

export interface TemplateResolver {
	resolve(package_id: string, version_set_id: string): Promise<PipelineTemplate | null>;
}

export interface LineageProvider {
	previous(package_id: string, version_set_id: string): Promise<string | null>;
}

export interface AuthGate {
	check(request: Request): Promise<Result<void, AuthError>>;
}

export interface PulseEmitterLite {
	emit(event: { event: string } & Record<string, unknown>): Promise<unknown>;
}

export type RoutesDeps = {
	db: Database;
	do_router: DoRouter;
	manifests: ManifestProvider;
	templates: TemplateResolver;
	lineage: LineageProvider;
	// Optional: present when this Worker is wired to accept artifact
	// uploads. Old tests that only exercise `/runs` continue to pass a
	// minimal `RoutesDeps` without these.
	backend?: Backend;
	auth?: AuthGate;
	pulse?: PulseEmitterLite;
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

		const manifest = await deps.manifests.get(parsed.data.version_set_id);
		if (manifest === null) return json_err(404, { code: "not_found", resource: "version_set_manifest", id: parsed.data.version_set_id });

		const template = await deps.templates.resolve(parsed.data.package_id, parsed.data.version_set_id);
		if (template === null) return json_err(404, { code: "not_found", resource: "pipeline_template", id: parsed.data.package_id });

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

	app.get("/runs", async c => {
		const deps = c.get("deps");
		const filter = parse_list_runs_query(c.req.query());
		if (!filter.ok) return json_err(400, filter.error);

		const result = await list_runs(deps.db, filter.value);
		if (!result.ok) return json_err(500, result.error);
		return json_ok(result.value);
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

	// ─── Artifact upload routes ─────────────────────────────────────
	//
	// `POST /artifacts/blob` — accepts an `application/octet-stream`
	// body and stores it in a named corpus store. Returns the assigned
	// version, content hash, and the `<store_id>/<content_hash>` ref the
	// CLI uses when building the manifest body.
	//
	// `POST /artifacts/version-set` — accepts a JSON `VersionSetManifest`
	// body and stores it via `version_set_store(...).put(...)`. Returns
	// the corpus version (`version_set_id`).
	//
	// Both routes are gated by `auth.check(request)` reading
	// `env.PIPELINES_TOKEN`. Read-only routes above this point are
	// intentionally unauthenticated.

	app.post("/artifacts/blob", async c => apply_artifact_blob(c.req.raw, c.get("deps")));
	app.post("/artifacts/version-set", async c => apply_artifact_version_set(c.req.raw, c.get("deps")));

	app.get("/health", c => c.json({ status: "ok", timestamp: new Date().toISOString() }));

	return app;
};

const MAX_BLOB_SIZE_BYTES = 25 * 1024 * 1024; // 25 MiB — generous for worker bundles + assets
const BLOB_STORE_ID_PATTERN = /^[a-z0-9-]{1,64}$/;

const apply_auth = async (deps: RoutesDeps, request: Request): Promise<Response | null> => {
	if (deps.auth === undefined) {
		return json_err(503, { code: "auth_unavailable", message: "artifact upload not configured on this Worker" });
	}
	const check = await deps.auth.check(request);
	if (!check.ok) {
		const status = check.error.code === "auth_unavailable" ? 503 : 401;
		return json_err(status, check.error);
	}
	return null;
};

const apply_artifact_blob = async (request: Request, deps: RoutesDeps): Promise<Response> => {
	const auth_fail = await apply_auth(deps, request);
	if (auth_fail !== null) return auth_fail;
	if (deps.backend === undefined) return json_err(503, { code: "backend_unavailable", message: "corpus backend not configured" });

	const store_id = request.headers.get("x-store-id");
	if (store_id === null || !BLOB_STORE_ID_PATTERN.test(store_id)) {
		return json_err(400, { code: "invalid_store_id", message: "x-store-id header required: [a-z0-9-]{1,64}" });
	}

	const content_length = Number(request.headers.get("content-length") ?? "0");
	if (content_length > MAX_BLOB_SIZE_BYTES) {
		return json_err(413, { code: "payload_too_large", message: `body exceeds ${MAX_BLOB_SIZE_BYTES} bytes`, limit: MAX_BLOB_SIZE_BYTES });
	}

	const buffer = await request.arrayBuffer().catch(() => null);
	if (buffer === null) return json_err(400, { code: "invalid_body", message: "could not read body" });
	if (buffer.byteLength > MAX_BLOB_SIZE_BYTES) return json_err(413, { code: "payload_too_large", message: `body exceeds ${MAX_BLOB_SIZE_BYTES} bytes`, limit: MAX_BLOB_SIZE_BYTES });

	const bytes = new Uint8Array(buffer);
	const content_hash = await sha256_hex(bytes);
	const version = generate_version();
	const data_key = `${store_id}/${content_hash}`;

	const put_data = await deps.backend.data.put(data_key, bytes);
	if (!put_data.ok) return json_err(500, { code: "storage_error", message: format_corpus_error(put_data.error) });

	const meta = {
		store_id,
		version,
		parents: [],
		created_at: new Date(),
		content_hash,
		content_type: "application/octet-stream" as const,
		size_bytes: bytes.byteLength,
		data_key,
	};
	const put_meta = await deps.backend.metadata.put(meta);
	if (!put_meta.ok) return json_err(500, { code: "storage_error", message: format_corpus_error(put_meta.error) });

	if (deps.pulse !== undefined) await deps.pulse.emit({ event: "artifact_uploaded", store_id, content_hash, kind: "blob" }).catch(() => undefined);

	return json_ok({ version, content_hash, store_id, ref: data_key });
};

const apply_artifact_version_set = async (request: Request, deps: RoutesDeps): Promise<Response> => {
	const auth_fail = await apply_auth(deps, request);
	if (auth_fail !== null) return auth_fail;
	if (deps.backend === undefined) return json_err(503, { code: "backend_unavailable", message: "corpus backend not configured" });

	const body = await request.json().catch(() => null);
	if (body === null) return json_err(400, { code: "invalid_body", message: "request body is not valid JSON" });

	const parsed = VersionSetManifestSchema.safeParse(body);
	if (!parsed.success) return json_err(400, { code: "invalid_manifest", issues: parsed.error.issues });

	const manifest = parsed.data as VersionSetManifest;
	const store = version_set_store(deps.backend);
	const put = await store.put(manifest);
	if (!put.ok) return json_err(500, { code: "storage_error", message: format_corpus_error(put.error) });

	if (deps.pulse !== undefined)
		await deps.pulse.emit({ event: "artifact_uploaded", store_id: "version-sets", content_hash: put.value.content_hash, kind: "version_set", package: manifest.package }).catch(() => undefined);

	return json_ok({ version_set_id: put.value.version, content_hash: put.value.content_hash, package: manifest.package });
};

const format_corpus_error = (e: { kind: string; message?: string; cause?: { message?: string } }): string => {
	if (e.message !== undefined) return e.message;
	if (e.cause?.message !== undefined) return e.cause.message;
	return e.kind;
};

const sha256_hex = async (bytes: Uint8Array): Promise<string> => {
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	const view = new Uint8Array(digest);
	let out = "";
	for (let i = 0; i < view.length; i++) out += view[i].toString(16).padStart(2, "0");
	return out;
};

/**
 * Generate a time-sortable lexicographic version id. Mirrors the corpus
 * default — a millisecond timestamp + 6 random hex chars — but kept
 * local so the route handler doesn't reach into corpus internals.
 */
const generate_version = (): string => {
	const ts = Date.now().toString(36).padStart(9, "0");
	const rand = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");
	return `v_${ts}_${rand}`;
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
	const manifest = await deps.manifests.get(version_set_id);
	if (manifest === null) return null;
	const template = await deps.templates.resolve(package_id, version_set_id);
	if (template === null) return null;
	const previous_version_set_id = await deps.lineage.previous(package_id, version_set_id);
	return resolve_run_plan({ template, manifest, version_set_id, previous_version_set_id });
};
