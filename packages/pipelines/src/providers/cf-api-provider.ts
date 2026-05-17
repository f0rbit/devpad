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
 *   POST   /accounts/:account_id/workers/scripts/:script/deployments
 *   GET    /accounts/:account_id/workers/scripts/:script/deployments
 *   GET    /accounts/:account_id/workers/scripts/:script
 *
 * `assert_version_key_header_routed` is a Transform-Rule simulation in the
 * fake. The real production check is "does the configured Transform Rule
 * resolve this version_key to a known version" — there is no public CF
 * API for that today, so the production implementation defers to a
 * head-of-line check via `versions.list` and matches the
 * `version_set_id` annotation. Returns `not_found` if no matching
 * version exists.
 */

import { err, ok, type Result } from "@f0rbit/corpus";
import type {
	CloudflareError,
	CloudflareProvider,
	CreateDeploymentInput,
	UploadVersionInput,
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

type CfEnvelope<T> = {
	success: boolean;
	errors: Array<{ code: number; message: string }>;
	messages: Array<{ code: number; message: string }>;
	result: T;
};

const CF_API_BASE = "https://api.cloudflare.com/client/v4";

const headers_for = (config: CfApiConfig): Record<string, string> => ({
	authorization: `Bearer ${config.api_token}`,
	"content-type": "application/json",
});

const cf_call = async <T>(
	config: CfApiConfig,
	path: string,
	init: RequestInit & { method: string },
): Promise<Result<T, CloudflareError>> => {
	const base = config.base_url ?? CF_API_BASE;
	const url = `${base}/accounts/${config.account_id}${path}`;
	let response: Response;
	try {
		response = await fetch(url, { ...init, headers: { ...headers_for(config), ...(init.headers ?? {}) } });
	} catch (e) {
		return err({ code: "internal", message: `cf api fetch failed: ${String(e)}` });
	}
	const body_text = await response.text().catch(() => "");
	if (response.status === 404) return err({ code: "not_found", message: body_text || "cf api 404" });
	if (response.status === 409) return err({ code: "conflict", message: body_text || "cf api 409" });
	if (response.status >= 400 && response.status < 500) return err({ code: "validation", message: body_text || `cf api ${response.status}` });
	if (response.status >= 500) return err({ code: "internal", message: body_text || `cf api ${response.status}` });
	let parsed: CfEnvelope<T>;
	try {
		parsed = JSON.parse(body_text) as CfEnvelope<T>;
	} catch (e) {
		return err({ code: "internal", message: `cf api decode failed: ${String(e)}` });
	}
	if (!parsed.success) {
		const message = parsed.errors?.[0]?.message ?? "cf api unsuccessful";
		return err({ code: "internal", message });
	}
	return ok(parsed.result);
};

type CfBinding = { type: string; name: string; text?: string };

type CfWorkerVersionResponse = {
	id: string;
	number: number;
	metadata?: { created_on?: string; bindings?: CfBinding[] };
	annotations?: Record<string, string>;
};

const bindings_to_vars = (bindings: CfBinding[] | undefined): WorkerVar[] | undefined => {
	if (!bindings) return undefined;
	const plain = bindings.filter((b): b is CfBinding & { text: string } => b.type === "plain_text" && typeof b.text === "string");
	if (plain.length === 0) return undefined;
	return plain.map(b => ({ type: "plain_text" as const, name: b.name, text: b.text }));
};

const to_worker_version = (script_name: string, raw: CfWorkerVersionResponse): WorkerVersion => ({
	id: raw.id,
	script_name,
	number: raw.number,
	created_on: raw.metadata?.created_on ?? new Date().toISOString(),
	annotations: raw.annotations,
	vars: bindings_to_vars(raw.metadata?.bindings),
});

type CfDeploymentResponse = {
	id: string;
	created_on?: string;
	strategy?: string;
	versions?: Array<{ version_id: string; percentage: number }>;
};

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
 * Build a production {@link CloudflareProvider} that calls the public
 * CF REST API. Pure constructor — no IO at build time.
 */
export const make_cf_api_provider = (config: CfApiConfig): CloudflareProvider => {
	const versions = {
		upload: async (input: UploadVersionInput): Promise<Result<WorkerVersion, CloudflareError>> => {
			const path = `/workers/scripts/${encodeURIComponent(input.script_name)}/versions`;
			const bindings: CfBinding[] = (input.vars ?? []).map(v => ({ type: v.type, name: v.name, text: v.text }));
			const body: Record<string, unknown> = {
				annotations: input.annotations ?? {},
				metadata: { bindings },
			};
			const result = await cf_call<CfWorkerVersionResponse>(config, path, {
				method: "POST",
				body: JSON.stringify(body),
			});
			if (!result.ok) return result;
			return ok(to_worker_version(input.script_name, result.value));
		},
		list: async (script_name: string): Promise<Result<WorkerVersion[], CloudflareError>> => {
			const path = `/workers/scripts/${encodeURIComponent(script_name)}/versions`;
			const result = await cf_call<{ items: CfWorkerVersionResponse[] }>(config, path, { method: "GET" });
			if (!result.ok) return result;
			const items = result.value.items ?? [];
			return ok(items.map(v => to_worker_version(script_name, v)));
		},
	};

	const deployments = {
		create: async (input: CreateDeploymentInput): Promise<Result<WorkerDeployment, CloudflareError>> => {
			const path = `/workers/scripts/${encodeURIComponent(input.script_name)}/deployments`;
			const result = await cf_call<CfDeploymentResponse>(config, path, {
				method: "POST",
				body: JSON.stringify({
					strategy: "percentage",
					versions: input.strategy.versions,
				}),
			});
			if (!result.ok) return result;
			return ok(to_worker_deployment(input.script_name, result.value));
		},
		list: async (script_name: string): Promise<Result<WorkerDeployment[], CloudflareError>> => {
			const path = `/workers/scripts/${encodeURIComponent(script_name)}/deployments`;
			const result = await cf_call<{ deployments: CfDeploymentResponse[] }>(config, path, { method: "GET" });
			if (!result.ok) return result;
			const items = result.value.deployments ?? [];
			return ok(items.map(d => to_worker_deployment(script_name, d)));
		},
	};

	const workers = {
		get: async (script_name: string): Promise<Result<WorkerMeta, CloudflareError>> => {
			const path = `/workers/scripts/${encodeURIComponent(script_name)}`;
			const result = await cf_call<{ created_on?: string }>(config, path, { method: "GET" });
			if (!result.ok) return result;
			return ok({ script_name, created_on: result.value.created_on ?? new Date().toISOString() });
		},
	};

	const assert_version_key_header_routed = async (
		input: { script_name: string; version_key: string },
	): Promise<Result<{ resolved_version_id: string }, CloudflareError>> => {
		const list = await versions.list(input.script_name);
		if (!list.ok) return list;
		const matched = list.value.find(v => v.annotations?.version_set_id === input.version_key);
		if (!matched) return err({ code: "not_found", message: `no version matches version_key ${input.version_key}` });
		return ok({ resolved_version_id: matched.id });
	};

	return { versions, deployments, workers, assert_version_key_header_routed };
};
