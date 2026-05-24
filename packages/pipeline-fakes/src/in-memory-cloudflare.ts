import { err, ok, type Result } from "@f0rbit/corpus";
import type {
	AssetUpload,
	CloudflareError,
	CloudflareProvider,
	CreateDeploymentInput,
	DeploymentStrategy,
	ModuleUpload,
	UploadVersionInput,
	WorkerDeployment,
	WorkerMeta,
	WorkerVersion,
} from "./cloudflare-provider.ts";

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
	 * Test assertion: every recorded version on `script_name` carries the
	 * named var with the expected text. Throws (test-only) if any version
	 * is missing the var or has a mismatched value. No-op if the script has
	 * no versions.
	 */
	assertVersionHasVars(script_name: string, expected: Record<string, string>): void {
		const state = this.scripts.get(script_name);
		if (!state) {
			throw new Error(`InMemoryCloudflareProvider.assertVersionHasVars: script ${script_name} not found`);
		}
		for (const version of state.versions) {
			const actual = new Map((version.vars ?? []).map(v => [v.name, v.text]));
			for (const [name, text] of Object.entries(expected)) {
				const got = actual.get(name);
				if (got !== text) {
					throw new Error(`InMemoryCloudflareProvider.assertVersionHasVars: script="${script_name}" version="${version.id}" expected ${name}="${text}" got "${got ?? "<missing>"}"`);
				}
			}
		}
	}

	/**
	 * Test assertion: the latest version uploaded for `script_name`
	 * carries a `bundle` matching `expected_bytes`. Throws (test-only) on
	 * a script with no versions, a version with no bundle recorded, or a
	 * size/byte mismatch. Used to verify the orchestrator forwards the
	 * compiled worker bytes through to the upload provider.
	 */
	assertLatestVersionBundle(script_name: string, expected_bytes: Uint8Array): void {
		const state = this.scripts.get(script_name);
		if (!state || state.versions.length === 0) {
			throw new Error(`InMemoryCloudflareProvider.assertLatestVersionBundle: script ${script_name} has no versions`);
		}
		const latest = state.versions[state.versions.length - 1];
		if (latest.bundle === undefined) {
			throw new Error(`InMemoryCloudflareProvider.assertLatestVersionBundle: script="${script_name}" latest version did not record a bundle`);
		}
		if (latest.bundle.length !== expected_bytes.length) {
			throw new Error(`InMemoryCloudflareProvider.assertLatestVersionBundle: script="${script_name}" bundle length mismatch: got ${latest.bundle.length}, expected ${expected_bytes.length}`);
		}
		for (let i = 0; i < latest.bundle.length; i++) {
			if (latest.bundle[i] !== expected_bytes[i]) {
				throw new Error(`InMemoryCloudflareProvider.assertLatestVersionBundle: script="${script_name}" bundle byte mismatch at index ${i}`);
			}
		}
	}

	/**
	 * Look up a version recorded by this fake by `script_name` + `version_id`.
	 * Used by directory-bundle assertions below; returns undefined if the
	 * script or version is unknown.
	 */
	private find_version(script_name: string, version_id: string): WorkerVersion | undefined {
		return this.scripts.get(script_name)?.versions.find(v => v.id === version_id);
	}

	/**
	 * Test assertion: the named version recorded a `directory_bundle`
	 * upload whose module set matches `expected_module_names` exactly
	 * (order-insensitive). Throws (test-only) on any mismatch.
	 */
	assertVersionHasModules(script_name: string, version_id: string, expected_module_names: string[]): void {
		const version = this.find_version(script_name, version_id);
		if (!version) {
			throw new Error(`InMemoryCloudflareProvider.assertVersionHasModules: version ${version_id} on script ${script_name} not found`);
		}
		if (!version.modules) {
			throw new Error(`InMemoryCloudflareProvider.assertVersionHasModules: version ${version_id} on script ${script_name} has no modules (not a directory_bundle upload?)`);
		}
		const got = version.modules.map(m => m.name).sort();
		const expected = [...expected_module_names].sort();
		if (got.length !== expected.length || got.some((name, i) => name !== expected[i])) {
			throw new Error(`InMemoryCloudflareProvider.assertVersionHasModules: script="${script_name}" version="${version_id}" expected modules ${JSON.stringify(expected)} got ${JSON.stringify(got)}`);
		}
	}

	/**
	 * Test assertion: the named version recorded a `directory_bundle`
	 * upload with an `assets` bundle whose paths match `expected_asset_paths`
	 * exactly (order-insensitive). Throws (test-only) on any mismatch.
	 */
	assertVersionHasAssets(script_name: string, version_id: string, expected_asset_paths: string[]): void {
		const version = this.find_version(script_name, version_id);
		if (!version) {
			throw new Error(`InMemoryCloudflareProvider.assertVersionHasAssets: version ${version_id} on script ${script_name} not found`);
		}
		if (!version.assets) {
			throw new Error(`InMemoryCloudflareProvider.assertVersionHasAssets: version ${version_id} on script ${script_name} has no assets recorded`);
		}
		const got = version.assets.map(a => a.path).sort();
		const expected = [...expected_asset_paths].sort();
		if (got.length !== expected.length || got.some((path, i) => path !== expected[i])) {
			throw new Error(`InMemoryCloudflareProvider.assertVersionHasAssets: script="${script_name}" version="${version_id}" expected assets ${JSON.stringify(expected)} got ${JSON.stringify(got)}`);
		}
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
			if (input.kind === "directory_bundle") {
				return this.record_directory_bundle(input);
			}
			return this.record_single_file(input);
		},
		list: async (script_name: string): Promise<Result<WorkerVersion[], CloudflareError>> => {
			const state = this.scripts.get(script_name);
			if (!state) return err({ code: "not_found", message: `script ${script_name} not found` });
			return ok([...state.versions]);
		},
	};

	private async record_single_file(input: Extract<UploadVersionInput, { kind: "single_file" }>): Promise<Result<WorkerVersion, CloudflareError>> {
		const state = ensure_script(this.scripts, input.script_name);
		this.version_counter += 1;
		const version: WorkerVersion = {
			id: make_id("version"),
			script_name: input.script_name,
			number: this.version_counter,
			created_on: new Date().toISOString(),
			annotations: input.annotations,
			vars: input.vars,
			bundle: input.bundle,
		};
		state.versions.push(version);
		return ok(version);
	}

	private async record_directory_bundle(input: Extract<UploadVersionInput, { kind: "directory_bundle" }>): Promise<Result<WorkerVersion, CloudflareError>> {
		const module_names = new Set(input.modules.map(m => m.name));
		if (!module_names.has(input.main_module)) {
			return err({
				code: "validation",
				message: `directory_bundle upload references main_module="${input.main_module}" but no module with that name is present (have: ${[...module_names].join(", ")})`,
			});
		}
		if (input.assets !== undefined) {
			for (const asset of input.assets.assets) {
				if (asset.hash.length !== 32) {
					return err({
						code: "validation",
						message: `directory_bundle asset hash must be 32 hex chars, got length ${asset.hash.length} for ${asset.path}`,
					});
				}
			}
		}

		const state = ensure_script(this.scripts, input.script_name);
		this.version_counter += 1;
		const modules: ModuleUpload[] = input.modules.map(m => ({
			name: m.name,
			mime_type: m.mime_type,
			content: m.content,
		}));
		const assets: AssetUpload[] | undefined = input.assets
			? input.assets.assets.map(a => ({
				path: a.path,
				hash: a.hash,
				size_bytes: a.size_bytes,
				mime_type: a.mime_type,
				content: a.content,
			}))
			: undefined;
		const version: WorkerVersion = {
			id: make_id("version"),
			script_name: input.script_name,
			number: this.version_counter,
			created_on: new Date().toISOString(),
			annotations: input.annotations,
			vars: input.vars,
			modules,
			assets,
		};
		state.versions.push(version);
		return ok(version);
	}

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
