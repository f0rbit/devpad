import { err, ok, type Result } from "@f0rbit/corpus";
import type { CloudflareError, CloudflareProvider, CreateDeploymentInput, DeploymentStrategy, UploadVersionInput, WorkerDeployment, WorkerMeta, WorkerVersion } from "./cloudflare-provider.ts";

type ScriptState = {
	versions: WorkerVersion[];
	deployments: WorkerDeployment[];
	active_deployment: WorkerDeployment | null;
	version_keys: Map<string, string>; // version_key -> version_id (Transform Rule simulation)
	created_on: string;
};

const make_id = (prefix: string): string => `${prefix}_${crypto.randomUUID().slice(0, 8)}`;

const sum_percentages = (strategy: DeploymentStrategy): number => strategy.versions.reduce((acc, v) => acc + v.percentage, 0);

const ensure_script = (scripts: Map<string, ScriptState>, name: string): ScriptState => {
	const existing = scripts.get(name);
	if (existing) return existing;
	const fresh: ScriptState = {
		versions: [],
		deployments: [],
		active_deployment: null,
		version_keys: new Map(),
		created_on: new Date().toISOString(),
	};
	scripts.set(name, fresh);
	return fresh;
};

export class InMemoryCloudflareProvider implements CloudflareProvider {
	private readonly scripts = new Map<string, ScriptState>();
	private version_counter = 0;

	register_version_key(script_name: string, version_key: string, version_id: string): void {
		ensure_script(this.scripts, script_name).version_keys.set(version_key, version_id);
	}

	get_active_deployment(script_name: string): WorkerDeployment | null {
		return this.scripts.get(script_name)?.active_deployment ?? null;
	}

	/**
	 * Invariant: every deployment's percentage strategy must sum to exactly 100.
	 * Throws (in test context only) when violated.
	 */
	assertPercentageSum(): void {
		for (const [name, state] of this.scripts.entries()) {
			for (const deployment of state.deployments) {
				const total = sum_percentages(deployment.strategy);
				if (total !== 100) {
					throw new Error(`InMemoryCloudflareProvider invariant violation: script="${name}" deployment="${deployment.id}" percentages sum to ${total}, expected 100`);
				}
			}
		}
	}

	readonly versions = {
		upload: async (input: UploadVersionInput): Promise<Result<WorkerVersion, CloudflareError>> => {
			const state = ensure_script(this.scripts, input.script_name);
			this.version_counter += 1;
			const version: WorkerVersion = {
				id: make_id("version"),
				script_name: input.script_name,
				number: this.version_counter,
				created_on: new Date().toISOString(),
				annotations: input.annotations,
			};
			state.versions.push(version);
			return ok(version);
		},
		list: async (script_name: string): Promise<Result<WorkerVersion[], CloudflareError>> => {
			const state = this.scripts.get(script_name);
			if (!state) return err({ code: "not_found", message: `script ${script_name} not found` });
			return ok([...state.versions]);
		},
	};

	readonly deployments = {
		create: async (input: CreateDeploymentInput): Promise<Result<WorkerDeployment, CloudflareError>> => {
			const state = this.scripts.get(input.script_name);
			if (!state) return err({ code: "not_found", message: `script ${input.script_name} not found` });

			const total = sum_percentages(input.strategy);
			if (total !== 100) {
				return err({
					code: "validation",
					message: `deployment percentages must sum to 100, got ${total}`,
				});
			}

			const known_ids = new Set(state.versions.map(v => v.id));
			for (const v of input.strategy.versions) {
				if (!known_ids.has(v.version_id)) {
					return err({ code: "not_found", message: `version ${v.version_id} not uploaded` });
				}
				if (v.percentage < 0 || v.percentage > 100) {
					return err({ code: "validation", message: `version ${v.version_id} percentage out of range: ${v.percentage}` });
				}
			}

			const deployment: WorkerDeployment = {
				id: make_id("deployment"),
				script_name: input.script_name,
				created_on: new Date().toISOString(),
				strategy: input.strategy,
			};
			state.deployments.push(deployment);
			state.active_deployment = deployment;
			return ok(deployment);
		},
		list: async (script_name: string): Promise<Result<WorkerDeployment[], CloudflareError>> => {
			const state = this.scripts.get(script_name);
			if (!state) return err({ code: "not_found", message: `script ${script_name} not found` });
			return ok([...state.deployments]);
		},
	};

	readonly workers = {
		get: async (script_name: string): Promise<Result<WorkerMeta, CloudflareError>> => {
			const state = this.scripts.get(script_name);
			if (!state) return err({ code: "not_found", message: `script ${script_name} not found` });
			return ok({ script_name, created_on: state.created_on });
		},
	};

	async assert_version_key_header_routed(input: { script_name: string; version_key: string }): Promise<Result<{ resolved_version_id: string }, CloudflareError>> {
		const state = this.scripts.get(input.script_name);
		if (!state) return err({ code: "not_found", message: `script ${input.script_name} not found` });
		const resolved = state.version_keys.get(input.version_key);
		if (!resolved) {
			return err({
				code: "not_found",
				message: `no Transform Rule registered for version key ${input.version_key} on script ${input.script_name}`,
			});
		}
		return ok({ resolved_version_id: resolved });
	}
}
