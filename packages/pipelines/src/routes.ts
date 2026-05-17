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
import { create_run, get_run, is_terminal_status, list_runs, resolve_run_plan } from "@devpad/core/services/pipelines";
import { approve_grant, deny_grant, list_grants } from "@devpad/core/services/pipelines/grants";
import type { PipelineTemplate } from "@devpad/pipeline-templates";
import { pipeline_package, RUN_STATUSES, type RunStatus } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import type { Backend, Result, SnapshotMeta, VersionSetManifest } from "@f0rbit/corpus";
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

/**
 * Public wire envelope. Errors land here as a single flat object —
 * `{ ok: false, error: { code, message, ...details } }`. Service
 * Results use `kind` (corpus convention) internally; the route
 * boundary normalises that to `code` via {@link to_wire_error}.
 *
 * Status code mapping is also done at the boundary — service errors
 * carry their own typed discriminator, but HTTP status is the route's
 * concern.
 */

type WireError = { code: string; message?: string } & Record<string, unknown>;

const STATUS_BY_CODE: Record<string, number> = {
	not_found: 404,
	validation: 400,
	validation_error: 400,
	bad_request: 400,
	invalid_event: 409,
	terminal_state: 409,
	no_previous_version: 409,
	no_previous_version_set: 400,
	unauthorized: 401,
	auth_unavailable: 503,
	backend_unavailable: 503,
	storage_error: 500,
	store_error: 500,
	db_error: 500,
	network_error: 502,
	missing_gate: 500,
};

const status_for_code = (code: string): number => STATUS_BY_CODE[code] ?? 500;

/**
 * Normalise a service-layer error (`kind` discriminator, corpus convention)
 * into the public wire shape (`code` discriminator). Strips any outer
 * Result wrapping so a `{ ok, value | error }` envelope is never
 * double-wrapped when bubbled through the route layer.
 */
const to_wire_error = (input: unknown): WireError => {
	if (input === null || typeof input !== "object") return { code: "unknown", message: String(input) };
	const rec = input as Record<string, unknown>;

	// Strip any accidental Result-envelope wrapping (input was already
	// `{ ok: false, error: ... }`). Always unwrap to the underlying error.
	if (rec.ok === false && "error" in rec) return to_wire_error(rec.error);

	const code = typeof rec.code === "string" ? rec.code : typeof rec.kind === "string" ? rec.kind : "unknown";
	const { kind: _kind, code: _code, ok: _ok, ...rest } = rec;
	return { code, ...rest };
};

const json_err_raw = (status: number, error: WireError): Response =>
	new Response(JSON.stringify({ ok: false, error }), {
		status,
		headers: { "content-type": "application/json" },
	});

/**
 * Emit a wire error from a service/Result error (or a literal
 * `WireError`). If `status` is omitted it's derived from the code.
 */
const wire_err = (input: unknown, status?: number): Response => {
	const wire = to_wire_error(input);
	return json_err_raw(status ?? status_for_code(wire.code), wire);
};

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
		if (!parsed.success) return wire_err({ code: "invalid_body", issues: parsed.error.issues }, 400);
		const deps = c.get("deps");
		const package_row = (await deps.db.select().from(pipeline_package).where(eq(pipeline_package.id, parsed.data.package_id)))[0];
		if (package_row === undefined) return wire_err({ code: "not_found", resource: "pipeline_package", id: parsed.data.package_id });

		const manifest = await deps.manifests.get(parsed.data.version_set_id);
		if (manifest === null) return wire_err({ code: "not_found", resource: "version_set_manifest", id: parsed.data.version_set_id });

		const template = await deps.templates.resolve(parsed.data.package_id, parsed.data.version_set_id);
		if (template === null) return wire_err({ code: "not_found", resource: "pipeline_template", id: parsed.data.package_id });

		const previous_version_set_id = await deps.lineage.previous(parsed.data.package_id, parsed.data.version_set_id);

		const created = await create_run(deps.db, {
			package_id: parsed.data.package_id,
			template,
			manifest,
			version_set_id: parsed.data.version_set_id,
			previous_version_set_id,
		});
		if (!created.ok) return wire_err(created.error);

		const { run, plan } = created.value;
		const advance_res = await do_call(deps, run.id, "advance", { plan });
		const advance_body = await advance_res.json().catch(() => null);
		if (advance_res.status >= 400) return wire_err(advance_body, advance_res.status);

		return json_ok({ run_id: run.id, status: run.status, plan, advance: advance_body });
	});

	app.get("/runs", async c => {
		const deps = c.get("deps");
		const filter = parse_list_runs_query(c.req.query());
		if (!filter.ok) return wire_err(filter.error, 400);

		const result = await list_runs(deps.db, filter.value);
		if (!result.ok) return wire_err(result.error);
		return json_ok(result.value);
	});

	app.get("/runs/:id", async c => {
		const deps = c.get("deps");
		const run = await get_run(deps.db, c.req.param("id"));
		if (!run.ok) return wire_err(run.error);
		return json_ok(run.value);
	});

	app.post("/runs/:id/approve", async c => {
		const body = await c.req.json().catch(() => null);
		const parsed = approve_body.safeParse(body);
		if (!parsed.success) return wire_err({ code: "invalid_body", issues: parsed.error.issues }, 400);
		const deps = c.get("deps");
		const run_id = c.req.param("id");

		// We need the plan for the DO call — read it from D1 (resolved_rollout + resolved_gates).
		const run = await get_run(deps.db, run_id);
		if (!run.ok) return wire_err(run.error);

		// Reconstruct the plan from the snapshot stored on the run row.
		// (The DO has the plan too, but we keep this read self-contained
		// so the route works even if the DO storage is cold.)
		const plan = await reconstruct_plan(deps, run.value.package_id, run.value.version_set_id);
		if (plan === null) return wire_err({ code: "plan_unavailable", run_id });

		const response = await do_call(deps, run_id, "approve", { ...parsed.data, plan });
		return normalise_do_response(response);
	});

	app.post("/runs/:id/cancel", async c => {
		const deps = c.get("deps");
		const run_id = c.req.param("id");
		const run = await get_run(deps.db, run_id);
		if (!run.ok) return wire_err(run.error);
		const plan = await reconstruct_plan(deps, run.value.package_id, run.value.version_set_id);
		if (plan === null) return wire_err({ code: "plan_unavailable", run_id });
		const response = await do_call(deps, run_id, "cancel", { plan });
		return normalise_do_response(response);
	});

	app.post("/runs/:id/rollback", async c => {
		const deps = c.get("deps");
		const run_id = c.req.param("id");
		const source_run = await get_run(deps.db, run_id);
		if (!source_run.ok) return wire_err(source_run.error);

		// Resolve the predecessor in lineage. If there is none, this run
		// has nothing to roll back to and we refuse — the operator should
		// re-upload a known-good version-set instead.
		const previous_version_set_id = await deps.lineage.previous(source_run.value.package_id, source_run.value.version_set_id);
		if (previous_version_set_id === null) {
			return wire_err({ code: "no_previous_version_set", run_id, version_set_id: source_run.value.version_set_id }, 400);
		}

		// In-flight source runs get cancelled first so we don't have two
		// runs trying to mutate the same script. Terminal-state sources are
		// left alone — the new rollback run carries the audit trail.
		if (!is_terminal_status(source_run.value.status)) {
			const source_plan = await reconstruct_plan(deps, source_run.value.package_id, source_run.value.version_set_id);
			if (source_plan !== null) {
				await do_call(deps, run_id, "cancel", { plan: source_plan }).catch(() => null);
			}
		}

		// Build the rollback run targeting the predecessor at 100%.
		const manifest = await deps.manifests.get(previous_version_set_id);
		if (manifest === null) return wire_err({ code: "not_found", resource: "version_set_manifest", id: previous_version_set_id });
		const template = await deps.templates.resolve(source_run.value.package_id, previous_version_set_id);
		if (template === null) return wire_err({ code: "not_found", resource: "pipeline_template", id: source_run.value.package_id });
		const predecessor_of_predecessor = await deps.lineage.previous(source_run.value.package_id, previous_version_set_id);

		const created = await create_run(deps.db, {
			package_id: source_run.value.package_id,
			template,
			manifest,
			version_set_id: previous_version_set_id,
			previous_version_set_id: predecessor_of_predecessor,
			kind: "rollback",
		});
		if (!created.ok) return wire_err(created.error);

		const { run, plan } = created.value;
		const advance_res = await do_call(deps, run.id, "advance", { plan });
		const advance_body = await advance_res.json().catch(() => null);
		if (advance_res.status >= 400) return wire_err(advance_body, advance_res.status);

		return json_ok({ run_id: run.id, status: run.status, kind: run.kind, target_version_set_id: previous_version_set_id, source_run_id: run_id, plan, advance: advance_body });
	});

	app.get("/grants", async c => {
		const deps = c.get("deps");
		const package_id = c.req.query("package_id");
		if (!package_id) return wire_err({ code: "missing_param", param: "package_id" }, 400);

		const grants_result = await list_grants(deps.db, package_id);
		if (!grants_result.ok) return wire_err(grants_result.error);
		return json_ok(grants_result.value);
	});

	app.post("/grants/:id/approve", async c => {
		const deps = c.get("deps");
		const body = await c.req.json().catch(() => null);
		const parsed = grant_approve_body.safeParse(body);
		if (!parsed.success) return wire_err({ code: "invalid_body", issues: parsed.error.issues }, 400);

		const grant_id = c.req.param("id");
		const result = await approve_grant(deps.db, grant_id, parsed.data.user_id);
		if (!result.ok) return wire_err(result.error);
		return json_ok(result.value);
	});

	app.post("/grants/:id/deny", async c => {
		const deps = c.get("deps");
		const body = await c.req.json().catch(() => null);
		const parsed = grant_deny_body.safeParse(body);
		if (!parsed.success) return wire_err({ code: "invalid_body", issues: parsed.error.issues }, 400);

		const grant_id = c.req.param("id");
		const result = await deny_grant(deps.db, grant_id, parsed.data.user_id, parsed.data.reason);
		if (!result.ok) return wire_err(result.error);
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
		return wire_err({ code: "auth_unavailable", message: "artifact upload not configured on this Worker" }, 503);
	}
	const check = await deps.auth.check(request);
	if (!check.ok) {
		const status = check.error.code === "auth_unavailable" ? 503 : 401;
		return wire_err(check.error, status);
	}
	return null;
};

const apply_artifact_blob = async (request: Request, deps: RoutesDeps): Promise<Response> => {
	const auth_fail = await apply_auth(deps, request);
	if (auth_fail !== null) return auth_fail;
	if (deps.backend === undefined) return wire_err({ code: "backend_unavailable", message: "corpus backend not configured" }, 503);

	const store_id = request.headers.get("x-store-id");
	if (store_id === null || !BLOB_STORE_ID_PATTERN.test(store_id)) {
		return wire_err({ code: "invalid_store_id", message: "x-store-id header required: [a-z0-9-]{1,64}" }, 400);
	}

	const content_length = Number(request.headers.get("content-length") ?? "0");
	if (content_length > MAX_BLOB_SIZE_BYTES) {
		return wire_err({ code: "payload_too_large", message: `body exceeds ${MAX_BLOB_SIZE_BYTES} bytes`, limit: MAX_BLOB_SIZE_BYTES }, 413);
	}

	const buffer = await request.arrayBuffer().catch(() => null);
	if (buffer === null) return wire_err({ code: "invalid_body", message: "could not read body" }, 400);
	if (buffer.byteLength > MAX_BLOB_SIZE_BYTES) return wire_err({ code: "payload_too_large", message: `body exceeds ${MAX_BLOB_SIZE_BYTES} bytes`, limit: MAX_BLOB_SIZE_BYTES }, 413);

	const bytes = new Uint8Array(buffer);
	const content_hash = await sha256_hex(bytes);
	const version = generate_version();
	const data_key = `${store_id}/${content_hash}`;

	const put_data = await deps.backend.data.put(data_key, bytes);
	if (!put_data.ok) return wire_err({ code: "storage_error", message: format_corpus_error(put_data.error) });

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
	if (!put_meta.ok) return wire_err({ code: "storage_error", message: format_corpus_error(put_meta.error) });

	if (deps.pulse !== undefined) await deps.pulse.emit({ event: "artifact_uploaded", store_id, content_hash, kind: "blob" }).catch(() => undefined);

	return json_ok({ version, content_hash, store_id, ref: data_key });
};

/**
 * Find the most recent existing version-set for a package — used to
 * stamp `parents` on a fresh put so `store.lineage(version)` walks back
 * through history. Without this the lineage chain is always [self] and
 * rollback can't find a predecessor.
 *
 * Cloudflare backend `metadata.list` orders by `created_at DESC` and
 * filters by tag in-memory after the query. The memory backend ignores
 * `opts.tags` entirely and yields in insertion order. To be robust
 * against both we iterate the whole stream, post-filter by the `pkg:*`
 * tag, and pick the max-by-`created_at`. Cap iteration at a sane bound
 * so a runaway store doesn't stall the route.
 *
 * "Latest" here = latest uploaded, not latest successfully deployed.
 * Phase 11+ can refine if rolling forward over a broken predecessor
 * becomes a real concern.
 */
const PARENT_LOOKUP_SCAN_LIMIT = 256;
const latest_version_for_package = async (backend: Backend, package_name: string): Promise<string | null> => {
	const pkg_tag = `pkg:${package_name}`;
	let best: SnapshotMeta | null = null;
	let scanned = 0;
	for await (const meta of backend.metadata.list("version-sets", { tags: [pkg_tag] })) {
		if (!meta.tags?.includes(pkg_tag)) continue;
		if (best === null || meta.created_at > best.created_at) best = meta;
		scanned += 1;
		if (scanned >= PARENT_LOOKUP_SCAN_LIMIT) break;
	}
	return best === null ? null : best.version;
};

const apply_artifact_version_set = async (request: Request, deps: RoutesDeps): Promise<Response> => {
	const auth_fail = await apply_auth(deps, request);
	if (auth_fail !== null) return auth_fail;
	if (deps.backend === undefined) return wire_err({ code: "backend_unavailable", message: "corpus backend not configured" }, 503);

	const body = await request.json().catch(() => null);
	if (body === null) return wire_err({ code: "invalid_body", message: "request body is not valid JSON" }, 400);

	const parsed = VersionSetManifestSchema.safeParse(body);
	if (!parsed.success) return wire_err({ code: "invalid_manifest", issues: parsed.error.issues }, 400);

	const manifest = parsed.data as VersionSetManifest;
	const store = version_set_store(deps.backend);

	// Look up the most recent existing version-set for this package so we
	// can stamp it as a parent — needed for `store.lineage` to walk back
	// through history, which the rollback route relies on.
	const parent_version = await latest_version_for_package(deps.backend, manifest.package);
	const put = await store.put(manifest, parent_version === null ? undefined : {
		parents: [{ store_id: "version-sets", version: parent_version, role: "predecessor" }],
	});
	if (!put.ok) return wire_err({ code: "storage_error", message: format_corpus_error(put.error) });

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

/**
 * Forward a Durable Object subrequest back to the HTTP client without
 * double-wrapping its envelope. The DO returns the same
 * `{ ok, value | error }` shape as this route layer; on error we
 * unwrap and re-emit via {@link wire_err} so the discriminator is
 * normalised to `code` and the response is single-wrapped.
 */
const normalise_do_response = async (response: Response): Promise<Response> => {
	const text = await response.text();
	if (response.status < 400) {
		return new Response(text, { status: response.status, headers: { "content-type": "application/json" } });
	}
	const parsed = text === "" ? null : (() => {
		try { return JSON.parse(text); } catch { return null; }
	})();
	return wire_err(parsed, response.status);
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
