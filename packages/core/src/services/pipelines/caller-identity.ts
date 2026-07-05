/**
 * @module core/services/pipelines/caller-identity
 *
 * Pure helper to compute the `CALLER_*` identity-var trio injected into
 * every Worker version uploaded by the orchestrator. Vault reads these
 * three bindings to identify the caller (which package, which env,
 * which version-set) before issuing a secret. Without them the vault
 * returns `identity_missing`.
 *
 * Locked names — must match vault's resolver
 * (`vault/src/identity.ts`):
 *  - `CALLER_PACKAGE`         — pipeline package name (e.g. `anthropic-search`)
 *  - `CALLER_ENV`             — `"staging"` or `"production"`
 *  - `CALLER_VERSION_SET_ID`  — the manifest's `version_set_id`
 */

import type { WorkerVar } from "@devpad/pipeline-fakes";

export type CallerIdentityInput = {
	package_name: string;
	// Not narrowed to the `"staging" | "production"` literal union deploy_stage
	// declares: every current caller already satisfies that union, so the
	// runtime check below is provably dead code against it (TS would flag the
	// `!== "production"` arm as always-false). Widening to `string` keeps this
	// a real boundary validation for any future/external caller instead of
	// deleting the defense-in-depth check outright.
	environment: string;
	version_set_id: string;
};

export type CallerIdentityError = { code: "invalid_identity"; message: string };

const CALLER_PACKAGE = "CALLER_PACKAGE";
const CALLER_ENV = "CALLER_ENV";
const CALLER_VERSION_SET_ID = "CALLER_VERSION_SET_ID";

const is_blank = (s: string): boolean => s.trim() === "";

/**
 * Compose the trio of plain-text Worker vars vault needs to identify a
 * deploy. All three fields are required and non-blank — vault treats a
 * missing or empty value the same as the binding being absent, so we
 * reject early with a typed error instead of letting it silently fall
 * back to `identity_missing` at request time.
 */
export const compute_caller_identity_vars = (input: CallerIdentityInput): WorkerVar[] => {
	if (is_blank(input.package_name)) {
		throw new Error("compute_caller_identity_vars: package_name is required");
	}
	if (is_blank(input.version_set_id)) {
		throw new Error("compute_caller_identity_vars: version_set_id is required");
	}
	if (input.environment !== "staging" && input.environment !== "production") {
		throw new Error(
			`compute_caller_identity_vars: environment must be "staging" or "production", got ${input.environment}`,
		);
	}
	return [
		{ type: "plain_text", name: CALLER_PACKAGE, text: input.package_name },
		{ type: "plain_text", name: CALLER_ENV, text: input.environment },
		{ type: "plain_text", name: CALLER_VERSION_SET_ID, text: input.version_set_id },
	];
};

/**
 * Convention shared with `resolve_script_name`: any stage literally
 * named `"staging"` deploys to the staging environment; everything else
 * (onebox, wave1, wave2, full, atomic-prod, …) is production.
 */
export const environment_for_stage = (stage_name: string): "staging" | "production" => {
	return stage_name === "staging" ? "staging" : "production";
};
