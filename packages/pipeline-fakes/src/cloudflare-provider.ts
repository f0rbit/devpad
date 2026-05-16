import type { Result } from "@f0rbit/corpus";

export type CloudflareError = { code: "not_found"; message: string } | { code: "validation"; message: string } | { code: "conflict"; message: string } | { code: "internal"; message: string };

export type WorkerVersion = {
	id: string;
	script_name: string;
	number: number;
	created_on: string;
	annotations?: Record<string, string>;
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
