import type { Result } from "@f0rbit/corpus";
import type { MODULE_MIME_TYPES } from "./manifests.ts";

export type CloudflareError =
	| { code: "not_found"; message: string }
	| { code: "validation"; message: string }
	| { code: "conflict"; message: string }
	| { code: "internal"; message: string }
	| { code: "assets_upload_failed"; message: string };

/**
 * A plain-text Worker var baked into a version at upload time. Mirrors the
 * Cloudflare REST shape used in `metadata.bindings`.
 *
 * Secrets-Store bindings ride a separate channel — these are only for
 * non-secret deploy-time identity (e.g. CALLER_PACKAGE).
 */
export type WorkerVar = { type: "plain_text"; name: string; text: string };

/**
 * Free-form binding entry sent as part of `metadata.bindings` on a
 * multipart version upload. The orchestrator passes through whatever
 * shape the caller hands it — service / kv_namespace / durable_object /
 * secret_text / etc. The `name` discriminator is the only universally
 * required field. Plain-text bindings are normally handed in via
 * {@link WorkerVar} (`vars`) and merged into the bindings array
 * downstream.
 */
export type VersionBinding = Record<string, unknown> & { type: string; name: string };

export type WorkerVersion = {
	id: string;
	script_name: string;
	number: number;
	created_on: string;
	annotations?: Record<string, string>;
	vars?: WorkerVar[];
	/**
	 * Bytes the orchestrator uploaded as the worker script. Recorded by
	 * the in-memory fake so tests can assert the bundle round-trips. The
	 * production provider doesn't surface this on read (CF doesn't return
	 * the bundle on its GET routes) — it stays undefined there.
	 *
	 * For directory-bundle uploads, this is unset and the per-module
	 * payloads are recorded under {@link modules} instead.
	 */
	bundle?: Uint8Array;
	/**
	 * For directory-bundle uploads: the list of module parts recorded by
	 * the in-memory fake (mirrors the multipart form parts sent on the
	 * wire). Unset for single-file uploads.
	 */
	modules?: ModuleUpload[];
	/**
	 * For directory-bundle uploads with an ASSETS binding: the list of
	 * static-asset files recorded by the in-memory fake. Unset for
	 * single-file uploads or directory-bundle uploads with no assets.
	 */
	assets?: AssetUpload[];
};

export type DeploymentStrategy = { strategy: "percentage"; versions: Array<{ version_id: string; percentage: number }> };

export type WorkerDeployment = {
	id: string;
	script_name: string;
	created_on: string;
	strategy: DeploymentStrategy;
};

export type WorkerMeta = {
	script_name: string;
	created_on: string;
};

/**
 * Wire-level MIME types accepted on a `versions.upload` module part.
 * Derived from {@link MODULE_MIME_TYPES} in `./manifests.ts` so the
 * Zod manifest schema and the wire-level type stay in lockstep — adding
 * a new MIME (e.g. another Pyodide variant) needs only one edit.
 */
export type ModuleMimeType = (typeof MODULE_MIME_TYPES)[number];

/**
 * One module file inside a directory-bundle Worker upload. The form-field
 * NAME on the multipart wire is {@link name} — for ES module parts the CF
 * runtime resolves relative imports inside the entrypoint against these
 * names; for `wasm_module` binding parts the `metadata.bindings[].part`
 * field references the same name.
 */
export type ModuleUpload = {
	name: string;
	mime_type: ModuleMimeType;
	content: Uint8Array;
};

/**
 * One static-asset file in an `ASSETS`-binding upload session. The
 * {@link hash} is BLAKE3 over `base64(content) + extension_without_dot`,
 * truncated to the first 32 hex chars (the exact algorithm wrangler 4.x
 * uses and the key CF's content-addressed asset store expects on both
 * the session manifest and the per-bucket multipart body).
 */
export type AssetUpload = {
	path: string;
	hash: string;
	size_bytes: number;
	mime_type: string;
	content: Uint8Array;
};

export type AssetConfig = {
	html_handling?: "auto-trailing-slash" | "force-trailing-slash" | "drop-trailing-slash" | "none";
	not_found_handling?: "404-page" | "single-page-application" | "none";
	run_worker_first?: boolean;
};

/**
 * Discriminated union of the two `versions.upload` shapes the orchestrator
 * supports.
 *
 * - `"single_file"` (legacy): one compiled worker bundle as a single
 *   `Uint8Array`, uploaded as a single ES-module part. Used by the
 *   bun-builder flow that ships a single `_worker.js` (anthropic-search,
 *   summarize, internal services).
 *
 * - `"directory_bundle"` (Phase 2.A+): multi-file Worker with explicit
 *   `modules[]`, optionally accompanied by an `ASSETS`-binding asset
 *   session. Used by the Astro/Remix output flow (`dist/_worker.js/`
 *   directory + `dist/client/` assets).
 *
 * Existing call sites must add `kind: "single_file"` — the discriminator
 * is mandatory.
 */
export type UploadVersionInput =
	| {
			kind: "single_file";
			script_name: string;
			annotations?: Record<string, string>;
			vars?: WorkerVar[];
			/**
			 * The compiled worker bundle bytes. Required by the production CF
			 * API provider (multipart upload demands the script part). The
			 * in-memory fake accepts uploads without it for backward compat
			 * with older tests that only exercised the metadata path.
			 */
			bundle?: Uint8Array;
			/**
			 * Filename of the main ES module entry inside the multipart body.
			 * Defaults to `"index.js"`. The chosen value is written into
			 * `metadata.main_module` AND used as the script part's form-field
			 * name — the CF API rejects uploads where the two disagree.
			 */
			main_module?: string;
			/** ISO date string. Defaults to `2024-04-03` (the rpc-default boundary). */
			compatibility_date?: string;
			/** Optional compat flags array (e.g. `["nodejs_compat"]`). */
			compatibility_flags?: string[];
			/**
			 * Non-`plain_text` bindings (service, kv_namespace,
			 * durable_object_namespace, secret_text, …). Merged with the
			 * `vars` mapping into the final `metadata.bindings` array on the
			 * wire.
			 */
			bindings?: VersionBinding[];
	  }
	| {
			kind: "directory_bundle";
			script_name: string;
			annotations?: Record<string, string>;
			vars?: WorkerVar[];
			/**
			 * Every module file in the bundle, each uploaded as its own
			 * multipart part. The {@link ModuleUpload.name} of one of these
			 * entries MUST equal {@link main_module} (CF rejects uploads where
			 * they disagree).
			 */
			modules: ModuleUpload[];
			/** Required for directory mode (e.g. `"index.js"`). */
			main_module: string;
			/** Required ISO date (CF rejects directory uploads without one). */
			compatibility_date: string;
			compatibility_flags?: string[];
			bindings?: VersionBinding[];
			/**
			 * Optional `ASSETS`-binding upload. When present, the provider
			 * opens an upload session, pushes the bytes, and then stamps
			 * `metadata.assets = { jwt, config }` on the versions upload so
			 * the new worker version binds to the just-uploaded asset set.
			 */
			assets?: {
				assets: AssetUpload[];
				config?: AssetConfig;
			};
	  };

export type CreateDeploymentInput = {
	script_name: string;
	strategy: DeploymentStrategy;
};

/**
 * Subset of the Cloudflare Workers API that the orchestrator drives.
 * The shape mirrors the public REST API's resource layout (versions, deployments, workers)
 * so the production provider is a thin fetch wrapper around this interface.
 *
 * Transform-Rule check: `assert_version_key_header_routed` returns Ok if a request carrying
 * the `Cloudflare-Workers-Version-Key` header would be routed to a known version. This
 * exists so the orchestrator can verify its zone-level Transform Rule wiring without
 * needing to actually deploy a Worker.
 */
export interface CloudflareProvider {
	versions: {
		upload(input: UploadVersionInput): Promise<Result<WorkerVersion, CloudflareError>>;
		list(script_name: string): Promise<Result<WorkerVersion[], CloudflareError>>;
	};
	deployments: {
		create(input: CreateDeploymentInput): Promise<Result<WorkerDeployment, CloudflareError>>;
		list(script_name: string): Promise<Result<WorkerDeployment[], CloudflareError>>;
	};
	workers: {
		get(script_name: string): Promise<Result<WorkerMeta, CloudflareError>>;
	};
	assert_version_key_header_routed(input: { script_name: string; version_key: string }): Promise<Result<{ resolved_version_id: string }, CloudflareError>>;
}
