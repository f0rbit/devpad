/**
 * @module pipelines/deps
 *
 * Production wiring for `RunDeps` (consumed by the run DO) and
 * `RoutesDeps` (consumed by the Hono routes) from the orchestrator
 * Worker's `PipelineEnv` bindings.
 *
 * Architecture:
 *
 * - `RoutesDeps` and `RunDeps` share the same D1, corpus backend, CF
 *   provider, pulse emitter, pulse summary client, and approval store.
 *   The factory builds the shared core once and returns both shapes.
 * - The CF API token comes through `env.CF_API_TOKEN.get()` (Secrets
 *   Store secret). The fetch happens lazily — the construction step
 *   captures the secret reference and the provider methods resolve it
 *   on the first call.
 * - Tests inject a fully synthesised env (`make_test_env`) so the same
 *   factory drives both production and the integration test.
 *
 * The structure mirrors the in-memory test harness in
 * `__tests__/integration/helpers.ts` — production swaps in-memory
 * providers for live ones; every dep type stays identical.
 */

import type { BundleProvider, RunDeps } from "@devpad/core/services/pipelines";
import type { CloudflareProvider, VersionBinding } from "@devpad/pipeline-fakes";
import { createD1Database } from "@devpad/schema/database/d1";
import type { Backend } from "@f0rbit/corpus";
import { create_cloudflare_backend } from "@f0rbit/corpus/cloudflare";
import { require_bearer_token } from "./auth.ts";
import type { PipelineEnv } from "./bindings.ts";
import { make_cf_router } from "./do-router.ts";
import { make_d1_approval_store } from "./providers/approval-store.ts";
import { make_cf_api_provider } from "./providers/cf-api-provider.ts";
import { make_corpus_bundle_provider, make_corpus_lineage_provider, make_corpus_manifest_provider, make_corpus_template_resolver } from "./providers/corpus-providers.ts";
import { make_pulse_emitter, make_pulse_summary_client } from "./providers/pulse.ts";
import type { AuthGate, PulseEmitterLite, RoutesDeps } from "./routes.ts";

/**
 * Wraps `env.CF_API_TOKEN.get()` so the provider can pull the secret on
 * first use. Cached after the first read — the token doesn't rotate
 * within a single Worker invocation. Throws lazily if `CF_API_TOKEN`
 * isn't bound — read-only routes that never hit the CF API stay
 * functional even before the secret is provisioned.
 */
const wrap_cf_token = (env: PipelineEnv): { get(): Promise<string> } => {
	let cached: string | null = null;
	return {
		async get(): Promise<string> {
			if (cached !== null) return cached;
			if (env.CF_API_TOKEN === undefined) {
				throw new Error("CF_API_TOKEN is not bound on this Worker; cannot make Cloudflare API calls");
			}
			const value = await env.CF_API_TOKEN.get();
			cached = value;
			return value;
		},
	};
};

const make_lazy_cf_provider = (env: PipelineEnv): CloudflareProvider => {
	const token = wrap_cf_token(env);
	let resolved: CloudflareProvider | null = null;
	const get_provider = async (): Promise<CloudflareProvider> => {
		if (resolved !== null) return resolved;
		if (!env.CF_ACCOUNT_ID) {
			throw new Error("CF_ACCOUNT_ID is not bound on this Worker; cannot make Cloudflare API calls");
		}
		const api_token = await token.get();
		resolved = make_cf_api_provider({ account_id: env.CF_ACCOUNT_ID, api_token });
		return resolved;
	};
	return {
		versions: {
			upload: async input => (await get_provider()).versions.upload(input),
			list: async script_name => (await get_provider()).versions.list(script_name),
		},
		deployments: {
			create: async input => (await get_provider()).deployments.create(input),
			list: async script_name => (await get_provider()).deployments.list(script_name),
		},
		workers: {
			get: async script_name => (await get_provider()).workers.get(script_name),
		},
		async assert_version_key_header_routed(input) {
			return (await get_provider()).assert_version_key_header_routed(input);
		},
	};
};

/**
 * Default bindings the orchestrator stamps onto every uploaded worker
 * version. Mirrors the wrangler.jsonc the scaffolder generates: a
 * service binding to the vault Worker, a service binding to the pulse
 * Worker, and `nodejs_compat`. The caller-identity `CALLER_*` trio is
 * added downstream by `deploy_stage`.
 *
 * Phase 12/13.C: platform services (vault, pulse) collapsed to singletons —
 * one Worker each, regardless of which environment is calling. Renamed
 * `vault-production` → `vault` and `pulse-api-production` → `pulse-api`
 * in Phase 13.C. Stage scoping moved from "which vault/pulse you talk
 * to" into `caller.environment` on the RPC identity arg (Phase 7) and
 * on pulse event tags. The demo Worker's own `staging`/`production`
 * split stays — it's only the upstream platform bindings that are
 * singletons.
 */
const default_bindings_for = (_input: { package_name: string; environment: "staging" | "production" }): VersionBinding[] => {
	// vault's `AnthropicVault` is exported as the module default —
	// service bindings that target the default export must NOT specify
	// an `entrypoint`. (Setting `entrypoint: "AnthropicVault"` triggers
	// `entrypoint name not found in this worker` at runtime because CF
	// only looks up *named* exports for `entrypoint`.)
	return [
		{ type: "service", name: "ANTHROPIC", service: "vault" },
		{ type: "service", name: "PULSE", service: "pulse-api" },
	];
};

/**
 * `make_corpus_bundle_provider` is the directory-aware factory — the
 * `BundlePayload` discriminated union it emits covers BOTH single-file and
 * directory-bundle manifests, so one factory satisfies `BundleProvider` for
 * every package shape (legacy `anthropic-*` Workers AND Astro/Remix bundles).
 */
const make_bundle_provider = (backend: Backend): BundleProvider =>
	make_corpus_bundle_provider(backend, {
		bindings_for: default_bindings_for,
		compatibility_flags: ["nodejs_compat"],
	});

/**
 * Shared core providers used by both the routes layer and the DO. Built
 * once per Worker invocation so the pulse emitter / approval store /
 * corpus backend instances are reused across requests.
 */
const build_core = (env: PipelineEnv) => {
	const db = createD1Database(env.DB);
	// Cast: corpus's local R2Bucket type uses `put: Promise<void>` while
	// the workers-types R2Bucket returns `Promise<R2Object | null>`. The
	// shapes are runtime-compatible — corpus discards the return value.
	const backend: Backend = create_cloudflare_backend({ d1: env.DB as never, r2: env.CORPUS_BUCKET as never });
	const cf = make_lazy_cf_provider(env);
	const pulse = make_pulse_emitter(env.PULSE);
	const pulse_summary = make_pulse_summary_client(env.PULSE);
	const approvals = make_d1_approval_store(db);
	const manifests = make_corpus_manifest_provider(backend);
	const bundles = make_bundle_provider(backend);
	return { db, backend, cf, pulse, pulse_summary, approvals, manifests, bundles };
};

/**
 * Build the `RunDeps` injected into the run Durable Object. The DO
 * touches D1 (run rows, stage events, approvals), the CF API
 * (deployments + versions), pulse (gate-pending notifications), and
 * the approval store via the manual-gate evaluator.
 */
export const build_run_deps_from_env = (env: PipelineEnv): RunDeps => {
	const core = build_core(env);
	return {
		db: core.db,
		cf: core.cf,
		bundles: core.bundles,
		pulse: core.pulse,
		approvals: core.approvals,
		pulse_summary: core.pulse_summary,
	};
};

/**
 * Build the `RoutesDeps` injected into the Hono app. The routes read D1
 * + corpus, dispatch into the DO, and accept artifact uploads on the
 * write-side (`POST /artifacts/*`). `cf` and `approvals` are not on
 * this shape (they're consumed by the DO via its own `RunDeps`).
 */
export const build_routes_deps_from_env = (env: PipelineEnv): RoutesDeps => {
	const core = build_core(env);
	const auth: AuthGate = { check: request => require_bearer_token(env, request) };
	const pulse_lite: PulseEmitterLite = { emit: async event => core.pulse.emit(event as never) };
	return {
		db: core.db,
		do_router: make_cf_router(env.PIPELINE_RUNS as unknown as { idFromName(name: string): unknown; get(id: unknown): { fetch(request: Request): Promise<Response> } }),
		manifests: core.manifests,
		templates: make_corpus_template_resolver(core.backend, core.manifests),
		lineage: make_corpus_lineage_provider(core.backend),
		backend: core.backend,
		auth,
		pulse: pulse_lite,
	};
};
