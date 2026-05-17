import type { Result } from "@f0rbit/corpus";

export type CloudflareError = { code: "not_found"; message: string } | { code: "validation"; message: string } | { code: "conflict"; message: string } | { code: "internal"; message: string };

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
	 */
	bundle?: Uint8Array;
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

export type UploadVersionInput = {
	script_name: string;
	annotations?: Record<string, string>;
	vars?: WorkerVar[];
	/**
	 * The compiled worker bundle bytes. Required by the production
	 * CF API provider (multipart upload demands the script part). The
	 * in-memory fake accepts uploads without it for backward compat with
	 * older tests that only exercised the metadata path.
	 */
	bundle?: Uint8Array;
	/**
	 * Filename of the main ES module entry inside the multipart body.
	 * Defaults to `"index.js"`. The chosen value is written into
	 * `metadata.main_module` AND used as the script part's form-field name —
	 * the CF API rejects uploads where the two disagree.
	 */
	main_module?: string;
	/** ISO date string. Defaults to `2024-04-03` (the rpc-default boundary). */
	compatibility_date?: string;
	/** Optional compat flags array (e.g. `["nodejs_compat"]`). */
	compatibility_flags?: string[];
	/**
	 * Non-`plain_text` bindings (service, kv_namespace, durable_object_namespace,
	 * secret_text, …). Merged with the `vars` mapping into the final
	 * `metadata.bindings` array on the wire.
	 */
	bindings?: VersionBinding[];
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
