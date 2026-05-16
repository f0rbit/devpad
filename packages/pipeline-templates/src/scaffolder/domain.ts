/**
 * @module pipeline-templates/scaffolder/domain
 *
 * Pure functions for the CLI scaffolder. Every export here is
 * deterministic and side-effect-free: no `Date.now()`, no `Math.random()`,
 * no filesystem, no network. The side-effect orchestrator (`scaffold_package`)
 * lives in `@devpad/cli` and feeds these functions a `now: Date` it captured
 * at the boundary.
 *
 * Layout:
 * - {@link validate_package_name} — npm-package-name subset enforcement
 * - {@link compute_compatibility_date} — wrangler `compatibility_date` value
 * - {@link derive_template_vars} — `ScaffolderInput` → `TemplateVars`
 * - {@link render_template} — Handlebars-style substitution with typed errors
 */

import { err, ok, type Result } from "@f0rbit/corpus";
import type { DefaultGateKind, RenderError, RolloutMode, ScaffolderInput, TemplateVars, ValidationError } from "./types.ts";

const MAX_PACKAGE_NAME_LENGTH = 40;
const PACKAGE_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

/**
 * Validate a CLI-supplied package name. Rules (deliberately tighter than
 * npm's): lowercase ASCII letters, digits, and hyphens; must start with a
 * letter; ≤ 40 chars. This is what `wrangler` and the GH Actions deploy
 * job tolerate cleanly, so we enforce it at the front door rather than at
 * deploy time.
 */
export const validate_package_name = (name: string): Result<void, ValidationError> => {
	if (name.length === 0) return err({ code: "package_name_empty", message: "package name must not be empty" });
	if (name.length > MAX_PACKAGE_NAME_LENGTH) {
		return err({
			code: "package_name_too_long",
			message: `package name must be ≤ ${MAX_PACKAGE_NAME_LENGTH} chars, got ${name.length}`,
			length: name.length,
		});
	}
	if (!PACKAGE_NAME_PATTERN.test(name)) {
		return err({
			code: "package_name_invalid_chars",
			message: `package name must match ${PACKAGE_NAME_PATTERN}; got "${name}"`,
			name,
		});
	}
	return ok(undefined);
};

/**
 * Cloudflare's `wrangler.jsonc` `compatibility_date` field — `YYYY-MM-DD`
 * in UTC. Pure: callers pass the captured `now` so tests can pin it.
 */
export const compute_compatibility_date = (now: Date): string => {
	const year = now.getUTCFullYear();
	const month = String(now.getUTCMonth() + 1).padStart(2, "0");
	const day = String(now.getUTCDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
};

const to_pascal_case = (name: string): string => {
	return name
		.split("-")
		.filter(part => part.length > 0)
		.map(part => part[0].toUpperCase() + part.slice(1))
		.join("");
};

const to_constant_case = (name: string): string => {
	return name.replace(/-/g, "_").toUpperCase();
};

const rollout_block_for = (mode: RolloutMode): string => {
	if (mode === "atomic") return `\t\trollout: { type: "atomic" },`;
	return `\t\trollout: {\n\t\t\ttype: "gradual",\n\t\t\t// Override stages here, e.g. { name: "onebox", traffic: 5, bake: "1h" }.\n\t\t\t// Omitted stages keep their defaultGradual values.\n\t\t\tstages: [],\n\t\t},`;
};

const gates_block_for = (mode: RolloutMode, gate: DefaultGateKind): string => {
	if (mode === "atomic") {
		if (gate === "manual") return `\t\tgates: {\n\t\t\t"staging→atomic-prod": manual(),\n\t\t},`;
		if (gate === "auto") return `\t\tgates: {\n\t\t\t"staging→atomic-prod": auto(),\n\t\t},`;
		return `\t\tgates: {\n\t\t\t"staging→atomic-prod": analysis({ template_id: "default" }),\n\t\t},`;
	}
	const gate_call = gate === "manual" ? "manual()" : gate === "auto" ? "auto({ afterBake: true })" : `analysis({ template_id: "default" })`;
	return `\t\tgates: {\n\t\t\t"staging→onebox": ${gate_call},\n\t\t\t"onebox→wave1": ${gate_call},\n\t\t\t"wave1→wave2": ${gate_call},\n\t\t\t"wave2→full": ${gate_call},\n\t\t},`;
};

const gate_import_for = (gate: DefaultGateKind): string => {
	if (gate === "manual") return "manual";
	if (gate === "auto") return "auto";
	return "analysis";
};

/**
 * Project a {@link ScaffolderInput} into the substitution dictionary
 * every template consumes. Pure and total — given a valid input (caller
 * runs {@link validate_package_name} first) this never errors.
 */
export const derive_template_vars = (input: ScaffolderInput): TemplateVars => {
	return {
		package_name: input.package_name,
		package_name_pascal: to_pascal_case(input.package_name),
		package_name_constant: to_constant_case(input.package_name),
		compatibility_date: compute_compatibility_date(input.now),
		rollout: input.rollout,
		default_gate: input.default_gate,
		rollout_block: rollout_block_for(input.rollout),
		gates_block: gates_block_for(input.rollout, input.default_gate),
		gate_import: gate_import_for(input.default_gate),
	};
};

const PLACEHOLDER_PATTERN = /\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/gi;

/**
 * Handlebars-style `{{name}}` substitution. Returns `err(missing_var)` if
 * the template references a key absent from `vars` — fail loudly rather
 * than silently emitting `undefined`.
 */
export const render_template = (template: string, vars: Record<string, string>): Result<string, RenderError> => {
	const matches: Array<{ full: string; key: string; index: number }> = [];
	for (const match of template.matchAll(PLACEHOLDER_PATTERN)) {
		matches.push({ full: match[0], key: match[1], index: match.index ?? 0 });
	}
	const missing = matches.find(m => !(m.key in vars));
	if (missing !== undefined) {
		const start = Math.max(0, missing.index - 20);
		const end = Math.min(template.length, missing.index + missing.full.length + 20);
		return err({
			code: "missing_var",
			message: `template references unknown variable "${missing.key}"`,
			var: missing.key,
			template_snippet: template.slice(start, end),
		});
	}
	return ok(template.replace(PLACEHOLDER_PATTERN, (_, key: string) => vars[key]));
};
