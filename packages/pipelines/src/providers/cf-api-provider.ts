/**
 * @module pipelines/providers/cf-api-provider
 *
 * Production {@link CloudflareProvider} backed by the public Cloudflare
 * Workers REST API. The shape mirrors the in-memory provider so the
 * orchestrator service layer is unaware whether it's hitting the real
 * API or the fake.
 *
 * Auth: Bearer token from the orchestrator Worker's `CF_API_TOKEN`
 * secret. The token needs `Workers Scripts:Edit` for the configured
 * account.
 *
 * Endpoints used (Cloudflare v4):
 *   POST   /accounts/:account_id/workers/scripts/:script/versions
 *   GET    /accounts/:account_id/workers/scripts/:script/versions
 *   GET    /accounts/:account_id/workers/scripts/:script/versions/:version
 *   POST   /accounts/:account_id/workers/scripts/:script/deployments
 *   GET    /accounts/:account_id/workers/scripts/:script/deployments
 *   GET    /accounts/:account_id/workers/scripts/:script
 *   POST   /accounts/:account_id/workers/scripts/:script/assets-upload-session
 *   POST   /accounts/:account_id/workers/assets/upload?base64=true
 *
 * The single-version GET (`versions/:version`) is the binding-preservation
 * read (#160): the orchestrator resolves the script's ACTIVE deployment
 * (deployments list, newest first), then reads each referenced version's
 * `metadata.bindings` — never the script settings endpoint, which reflects
 * the latest upload rather than what's live.
 *
 * `assert_version_key_header_routed` is a Transform-Rule simulation in the
 * fake. The real production check is "does the configured Transform Rule
 * resolve this version_key to a known version" — there is no public CF
 * API for that today, so the production implementation defers to a
 * head-of-line check via `versions.list` and matches the
 * `version_set_id` annotation. Returns `not_found` if no matching
 * version exists.
 *
 * Phase 2.A: extended with `directory_bundle` upload support — multiple
 * module parts in one multipart POST, with optional `ASSETS`-binding
 * upload session that ties a freshly-uploaded asset set to the new worker
 * version via `metadata.assets = { jwt, config }`.
 */

import { err, ok, type Result } from "@f0rbit/corpus";
import { z } from "zod";
import type {
	AssetConfig,
	AssetUpload,
	CloudflareError,
	CloudflareProvider,
	CreateDeploymentInput,
	UploadVersionInput,
	VersionBinding,
	WorkerDeployment,
	WorkerMeta,
	WorkerVar,
	WorkerVersion,
} from "@devpad/pipeline-fakes";

export type CfApiConfig = {
	account_id: string;
	api_token: string;
	/** Override for tests. Defaults to the public CF API. */
	base_url?: string;
};

// CF API envelope; `result` is parsed per-endpoint by the caller's schema.
const cf_envelope = z.object({
	success: z.boolean(),
	errors: z.array(z.object({ code: z.number(), message: z.string() })).default([]),
	result: z.unknown(),
});

const CF_API_BASE = "https://api.cloudflare.com/client/v4";

const auth_header = (config: CfApiConfig): Record<string, string> => ({
	authorization: `Bearer ${config.api_token}`,
});

const json_headers_for = (config: CfApiConfig): Record<string, string> => ({
	...auth_header(config),
	"content-type": "application/json",
});

const cf_url = (config: CfApiConfig, path: string): string => {
	const base = config.base_url ?? CF_API_BASE;
	return `${base}/accounts/${config.account_id}${path}`;
};

const interpret_response = async <T>(
	response: Response,
	schema: z.ZodType<T, z.ZodTypeDef, unknown>,
): Promise<Result<T, CloudflareError>> => {
	const body_text = await response.text().catch(() => "");
	if (response.status === 404) return err({ code: "not_found", message: body_text || "cf api 404" });
	if (response.status === 409) return err({ code: "conflict", message: body_text || "cf api 409" });
	if (response.status >= 400 && response.status < 500)
		return err({ code: "validation", message: body_text || `cf api ${String(response.status)}` });
	if (response.status >= 500)
		return err({ code: "internal", message: body_text || `cf api ${String(response.status)}` });
	let raw: unknown;
	try {
		const decoded: unknown = JSON.parse(body_text);
		raw = decoded;
	} catch (e) {
		return err({ code: "internal", message: `cf api decode failed: ${String(e)}` });
	}
	const envelope = cf_envelope.safeParse(raw);
	if (!envelope.success) {
		return err({ code: "internal", message: `cf api envelope invalid: ${envelope.error.message}` });
	}
	if (!envelope.data.success) {
		const message = envelope.data.errors[0]?.message ?? "cf api unsuccessful";
		return err({ code: "internal", message });
	}
	const result = schema.safeParse(envelope.data.result);
	if (!result.success) {
		return err({ code: "internal", message: `cf api result invalid: ${result.error.message}` });
	}
	return ok(result.data);
};

// `init.headers` is `RequestInit["headers"]` — may be a `Headers` instance
// (not a plain object) or a `[string, string][]` tuple list, so spreading it
// directly (`{ ...init.headers }`) can silently drop entries. Normalise to
// tuples first so every shape merges into `headers` correctly.
const header_entries = (h: RequestInit["headers"]): Array<[string, string]> => {
	if (h === undefined) return [];
	if (h instanceof Headers) return [...h.entries()];
	if (Array.isArray(h)) return h;
	return Object.entries(h);
};

const cf_call = async <T>(
	config: CfApiConfig,
	path: string,
	init: RequestInit & { method: string },
	schema: z.ZodType<T, z.ZodTypeDef, unknown>,
): Promise<Result<T, CloudflareError>> => {
	const url = cf_url(config, path);
	let response: Response;
	const headers = new Headers(json_headers_for(config));
	for (const [key, value] of header_entries(init.headers)) headers.set(key, value);
	try {
		response = await fetch(url, { ...init, headers });
	} catch (e) {
		return err({ code: "internal", message: `cf api fetch failed: ${String(e)}` });
	}
	return interpret_response(response, schema);
};

/**
 * Multipart `POST /workers/scripts/:script/versions` upload — the only
 * shape the CF Workers API accepts for new versions. The body has at
 * least two parts: a JSON `metadata` part describing main module /
 * bindings / compatibility, and one or more binary module parts whose
 * form-field names match the module paths declared in the bundle.
 *
 * For single-file uploads, the script part's form-field name MUST equal
 * `metadata.main_module` and its `Content-Type` distinguishes an ES
 * module (`application/javascript+module`) from a service-worker
 * (`application/javascript`).
 *
 * `fetch` derives the boundary from the supplied `FormData` — we leave
 * `Content-Type` unset so the runtime picks it.
 */
const cf_upload_multipart = async <T>(
	config: CfApiConfig,
	path: string,
	form: FormData,
	schema: z.ZodType<T, z.ZodTypeDef, unknown>,
): Promise<Result<T, CloudflareError>> => {
	const url = cf_url(config, path);
	let response: Response;
	try {
		response = await fetch(url, { method: "POST", body: form, headers: auth_header(config) });
	} catch (e) {
		return err({ code: "internal", message: `cf api fetch failed: ${String(e)}` });
	}
	return interpret_response(response, schema);
};

// Bindings stay an open record: the orchestrator only relies on `type` +
// `name`, every other field passes through verbatim (#160), so entries are
// narrowed field-by-field in `to_version_binding` rather than modelled.
const cf_binding = z.record(z.string(), z.unknown());
type CfBinding = z.infer<typeof cf_binding>;

const cf_worker_version = z.object({
	id: z.string(),
	number: z.number(),
	metadata: z
		.object({
			created_on: z.string().nullish(),
			bindings: z.array(cf_binding).nullish(),
			keep_bindings: z.array(z.string()).nullish(),
		})
		.nullish(),
	resources: z.object({ bindings: z.array(cf_binding).nullish() }).nullish(),
	annotations: z.record(z.string(), z.string()).nullish(),
});
type CfWorkerVersionResponse = z.infer<typeof cf_worker_version>;

const cf_worker_versions_list = z.object({ items: z.array(cf_worker_version).nullish() });

const cf_deployment = z.object({
	id: z.string(),
	created_on: z.string().nullish(),
	strategy: z.string().nullish(),
	versions: z.array(z.object({ version_id: z.string(), percentage: z.number() })).nullish(),
});
type CfDeploymentResponse = z.infer<typeof cf_deployment>;

const cf_deployments_list = z.object({ deployments: z.array(cf_deployment).nullish() });

const cf_script_meta = z.object({ created_on: z.string().nullish() });

const cf_asset_session = z.object({
	jwt: z.string(),
	buckets: z.array(z.array(z.string())).default([]),
});

/**
 * Cloudflare returns a version's bindings at `result.resources.bindings`
 * (https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/versions/methods/get/);
 * `metadata.bindings` is kept as a fallback for the upload-echo shape.
 */
const cf_bindings_of = (raw: CfWorkerVersionResponse): CfBinding[] | undefined =>
	raw.resources?.bindings ?? raw.metadata?.bindings ?? undefined;

/**
 * Map a CF `metadata.bindings[]` entry to a {@link VersionBinding}. The
 * orchestrator only relies on `type` + `name`; every other field rides a
 * passthrough record so binding types we don't model (d1, r2_bucket,
 * queue, ai, kv_namespace, vectorize, workflow, analytics_engine, …)
 * are preserved verbatim on the promotion path (#160) instead of being
 * dropped or rewritten.
 */
const to_version_binding = (b: CfBinding): VersionBinding | null => {
	const { type, name, text, ...rest } = b;
	if (typeof type !== "string" || typeof name !== "string") return null;
	return { ...rest, ...(typeof text === "string" ? { text } : {}), type, name };
};

const bindings_from_cf = (bindings: CfBinding[] | undefined): VersionBinding[] => {
	if (!bindings) return [];
	return bindings.map(to_version_binding).filter((b): b is VersionBinding => b !== null);
};

const bindings_to_vars = (bindings: CfBinding[] | undefined): WorkerVar[] | undefined => {
	if (!bindings) return undefined;
	const plain = bindings.flatMap((b): WorkerVar[] =>
		b.type === "plain_text" && typeof b.name === "string" && typeof b.text === "string"
			? [{ type: "plain_text", name: b.name, text: b.text }]
			: [],
	);
	return plain.length === 0 ? undefined : plain;
};

const to_worker_version = (script_name: string, raw: CfWorkerVersionResponse): WorkerVersion => ({
	id: raw.id,
	script_name,
	number: raw.number,
	created_on: raw.metadata?.created_on ?? new Date().toISOString(),
	annotations: raw.annotations ?? undefined,
	vars: bindings_to_vars(cf_bindings_of(raw)),
	bindings: bindings_from_cf(cf_bindings_of(raw)),
	keep_bindings: raw.metadata?.keep_bindings ?? undefined,
});

const to_worker_deployment = (script_name: string, raw: CfDeploymentResponse): WorkerDeployment => ({
	id: raw.id,
	script_name,
	created_on: raw.created_on ?? new Date().toISOString(),
	strategy: {
		strategy: "percentage",
		versions: raw.versions ?? [],
	},
});

/**
 * Build the metadata JSON for a `versions.upload` call. Pure — extracted
 * so the directory-bundle path and the single-file path produce identical
 * shapes from a unified input.
 */
const build_version_metadata = (input: {
	main_module: string;
	bindings: VersionBinding[];
	vars: WorkerVar[];
	compatibility_date: string;
	compatibility_flags: string[];
	annotations: Record<string, string>;
	keep_bindings?: string[];
	assets?: { jwt: string; config: AssetConfig };
}): Record<string, unknown> => {
	const vars_as_bindings: VersionBinding[] = input.vars.map((v) => ({ type: v.type, name: v.name, text: v.text }));
	const metadata: Record<string, unknown> = {
		main_module: input.main_module,
		bindings: [...input.bindings, ...vars_as_bindings],
		compatibility_date: input.compatibility_date,
		compatibility_flags: input.compatibility_flags,
		annotations: input.annotations,
	};
	// #160: secret bindings can't be re-sent (values never come back on
	// reads) — they ride `keep_bindings`, which Cloudflare resolves
	// against the script's previous upload (CF: "binding types to keep
	// from previous_upload"). Caveat documented in
	// AGENTS.md: latest-version inheritance is fine in practice because
	// every orchestrated upload already preserves secrets too, so the
	// latest version always carries the same secret binding set.
	if (input.keep_bindings !== undefined && input.keep_bindings.length > 0) {
		metadata.keep_bindings = input.keep_bindings;
	}
	if (input.assets !== undefined) {
		metadata.assets = { jwt: input.assets.jwt, config: input.assets.config };
	}
	return metadata;
};

/**
 * Encode a byte array as a base64 string. CF's assets/upload endpoint
 * expects raw base64 (no data URI prefix) when called with `?base64=true`.
 */
const to_base64 = (bytes: Uint8Array): string => {
	// Bun provides `btoa` natively, but it operates on binary strings;
	// avoid the intermediate string allocation for large blobs by using
	// Buffer when available (Bun/Node), falling back to a chunked btoa.
	if (typeof Buffer !== "undefined") {
		return Buffer.from(bytes).toString("base64");
	}
	let binary = "";
	for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
	return btoa(binary);
};

/**
 * Open an assets-upload session for `script_name` and push every bucket
 * via the per-bucket multipart endpoint. Returns the session jwt so the
 * caller can stamp it on the version's `metadata.assets`.
 */
const upload_asset_session = async (
	config: CfApiConfig,
	script_name: string,
	assets: AssetUpload[],
): Promise<Result<{ jwt: string }, CloudflareError>> => {
	const manifest: Record<string, { hash: string; size: number }> = {};
	for (const asset of assets) {
		if (asset.hash.length !== 32) {
			return err({
				code: "validation",
				message: `asset hash must be 32 hex chars, got length ${String(asset.hash.length)} for ${asset.path}`,
			});
		}
		manifest[asset.path] = { hash: asset.hash, size: asset.size_bytes };
	}

	const session_path = `/workers/scripts/${encodeURIComponent(script_name)}/assets-upload-session`;
	const session = await cf_call(
		config,
		session_path,
		{
			method: "POST",
			body: JSON.stringify({ manifest }),
		},
		cf_asset_session,
	);
	if (!session.ok) return session;

	if (assets.length === 0) {
		return ok({ jwt: session.value.jwt });
	}

	const by_hash = new Map(assets.map((a) => [a.hash, a]));
	const upload_url = cf_url(config, "/workers/assets/upload?base64=true");

	for (const bucket of session.value.buckets) {
		if (bucket.length === 0) continue;
		const form = new FormData();
		for (const hash of bucket) {
			const asset = by_hash.get(hash);
			if (!asset) {
				return err({
					code: "assets_upload_failed",
					message: `assets-upload-session returned bucket with unknown hash ${hash}`,
				});
			}
			form.append(hash, new Blob([to_base64(asset.content)], { type: asset.mime_type || "application/null" }), hash);
		}
		let response: Response;
		try {
			response = await fetch(upload_url, {
				method: "POST",
				body: form,
				headers: { authorization: `Bearer ${session.value.jwt}` },
			});
		} catch (e) {
			return err({ code: "assets_upload_failed", message: `assets/upload fetch failed: ${String(e)}` });
		}
		if (response.status >= 400) {
			const body_text = await response.text().catch(() => "");
			return err({
				code: "assets_upload_failed",
				message: `assets/upload returned ${String(response.status)}: ${body_text || "<no body>"}`,
			});
		}
	}

	return ok({ jwt: session.value.jwt });
};

const upload_single_file = async (
	config: CfApiConfig,
	input: Extract<UploadVersionInput, { kind: "single_file" }>,
): Promise<Result<WorkerVersion, CloudflareError>> => {
	if (input.bundle === undefined) {
		return err({
			code: "validation",
			message: "cf-api-provider.versions.upload requires `bundle` bytes for multipart upload",
		});
	}
	const path = `/workers/scripts/${encodeURIComponent(input.script_name)}/versions`;
	const main_module = input.main_module ?? "index.js";
	const metadata = build_version_metadata({
		main_module,
		bindings: input.bindings ?? [],
		vars: input.vars ?? [],
		compatibility_date: input.compatibility_date ?? "2024-04-03",
		compatibility_flags: input.compatibility_flags ?? [],
		annotations: input.annotations ?? {},
		keep_bindings: input.keepBindings,
	});

	const form = new FormData();
	form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
	form.append(main_module, new Blob([input.bundle], { type: "application/javascript+module" }), main_module);

	const result = await cf_upload_multipart(config, path, form, cf_worker_version);
	if (!result.ok) return result;
	return ok(to_worker_version(input.script_name, result.value));
};

const upload_directory_bundle = async (
	config: CfApiConfig,
	input: Extract<UploadVersionInput, { kind: "directory_bundle" }>,
): Promise<Result<WorkerVersion, CloudflareError>> => {
	const module_names = new Set(input.modules.map((m) => m.name));
	if (!module_names.has(input.main_module)) {
		return err({
			code: "validation",
			message: `directory_bundle upload references main_module="${input.main_module}" but no module with that name is present (have: ${[...module_names].join(", ")})`,
		});
	}

	let assets_meta: { jwt: string; config: AssetConfig } | undefined;
	if (input.assets !== undefined) {
		const session = await upload_asset_session(config, input.script_name, input.assets.assets);
		if (!session.ok) return session;
		assets_meta = { jwt: session.value.jwt, config: input.assets.config ?? {} };
	}

	const path = `/workers/scripts/${encodeURIComponent(input.script_name)}/versions`;
	const metadata = build_version_metadata({
		main_module: input.main_module,
		bindings: input.bindings ?? [],
		vars: input.vars ?? [],
		compatibility_date: input.compatibility_date,
		compatibility_flags: input.compatibility_flags ?? [],
		annotations: input.annotations ?? {},
		keep_bindings: input.keepBindings,
		assets: assets_meta,
	});

	const form = new FormData();
	form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
	for (const module of input.modules) {
		form.append(module.name, new Blob([module.content], { type: module.mime_type }), module.name);
	}

	const result = await cf_upload_multipart(config, path, form, cf_worker_version);
	if (!result.ok) return result;
	return ok(to_worker_version(input.script_name, result.value));
};

/**
 * Build a production {@link CloudflareProvider} that calls the public
 * CF REST API. Pure constructor — no IO at build time.
 */
export const make_cf_api_provider = (config: CfApiConfig): CloudflareProvider => {
	const versions = {
		upload: async (input: UploadVersionInput): Promise<Result<WorkerVersion, CloudflareError>> => {
			if (input.kind === "directory_bundle") {
				return upload_directory_bundle(config, input);
			}
			return upload_single_file(config, input);
		},
		list: async (script_name: string): Promise<Result<WorkerVersion[], CloudflareError>> => {
			const path = `/workers/scripts/${encodeURIComponent(script_name)}/versions`;
			const result = await cf_call(config, path, { method: "GET" }, cf_worker_versions_list);
			if (!result.ok) return result;
			const items = result.value.items ?? [];
			return ok(items.map((v) => to_worker_version(script_name, v)));
		},
		get: async (script_name: string, version_id: string): Promise<Result<WorkerVersion, CloudflareError>> => {
			const path = `/workers/scripts/${encodeURIComponent(script_name)}/versions/${encodeURIComponent(version_id)}`;
			const result = await cf_call(config, path, { method: "GET" }, cf_worker_version);
			if (!result.ok) return result;
			return ok(to_worker_version(script_name, result.value));
		},
	};

	const deployments = {
		create: async (input: CreateDeploymentInput): Promise<Result<WorkerDeployment, CloudflareError>> => {
			const path = `/workers/scripts/${encodeURIComponent(input.script_name)}/deployments`;
			const result = await cf_call(
				config,
				path,
				{
					method: "POST",
					body: JSON.stringify({
						strategy: "percentage",
						versions: input.strategy.versions,
					}),
				},
				cf_deployment,
			);
			if (!result.ok) return result;
			return ok(to_worker_deployment(input.script_name, result.value));
		},
		list: async (script_name: string): Promise<Result<WorkerDeployment[], CloudflareError>> => {
			const path = `/workers/scripts/${encodeURIComponent(script_name)}/deployments`;
			const result = await cf_call(config, path, { method: "GET" }, cf_deployments_list);
			if (!result.ok) return result;
			const items = result.value.deployments ?? [];
			return ok(items.map((d) => to_worker_deployment(script_name, d)));
		},
	};

	const workers = {
		get: async (script_name: string): Promise<Result<WorkerMeta, CloudflareError>> => {
			const path = `/workers/scripts/${encodeURIComponent(script_name)}`;
			const result = await cf_call(config, path, { method: "GET" }, cf_script_meta);
			if (!result.ok) return result;
			return ok({ script_name, created_on: result.value.created_on ?? new Date().toISOString() });
		},
	};

	const assert_version_key_header_routed = async (input: {
		script_name: string;
		version_key: string;
	}): Promise<Result<{ resolved_version_id: string }, CloudflareError>> => {
		const list = await versions.list(input.script_name);
		if (!list.ok) return list;
		// Mirrors the orchestrator's annotation convention from
		// `deploy.ts` — `workers/tag` carries the version_set_id (CF
		// rejects any other annotation key with validation error 10021).
		const matched = list.value.find((v) => v.annotations?.["workers/tag"] === input.version_key);
		if (!matched) return err({ code: "not_found", message: `no version matches version_key ${input.version_key}` });
		return ok({ resolved_version_id: matched.id });
	};

	return { versions, deployments, workers, assert_version_key_header_routed };
};

/**
 * Exposed for direct testing. Pure helper that turns a list of assets
 * into the `{ "<path>": { hash, size } }` manifest body expected by the
 * `assets-upload-session` POST.
 */
export const build_assets_manifest = (assets: AssetUpload[]): Record<string, { hash: string; size: number }> => {
	const out: Record<string, { hash: string; size: number }> = {};
	for (const asset of assets) out[asset.path] = { hash: asset.hash, size: asset.size_bytes };
	return out;
};
