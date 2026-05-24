/**
 * @module core/services/pipelines/script-name
 *
 * Pure function to resolve the Cloudflare Worker script name for a pipeline
 * package and stage. Handles conventions (staging → `${name}-staging`, others
 * → `${name}`) and per-stage overrides.
 */

export type ScriptNameInput = {
	package: {
		name: string;
		script_name_overrides: Record<string, string> | null;
	};
	stage_name: string;
};

export const resolve_script_name = (input: ScriptNameInput): string => {
	const { package: pkg, stage_name } = input;

	if (!pkg.name || pkg.name.trim() === "") {
		throw new Error("Package name is required");
	}

	if (!stage_name || stage_name.trim() === "") {
		throw new Error("Stage name is required");
	}

	// Check if there's an explicit override for this stage
	if (pkg.script_name_overrides && pkg.script_name_overrides[stage_name]) {
		return pkg.script_name_overrides[stage_name];
	}

	// Convention: "staging" → `${name}-staging`, all others → `${name}`
	if (stage_name === "staging") {
		return `${pkg.name}-staging`;
	}

	return pkg.name;
};
