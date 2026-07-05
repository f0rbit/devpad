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
import type {
	DefaultGateKind,
	RenderError,
	RolloutMode,
	ScaffolderInput,
	TemplateVars,
	ValidationError,
} from "./types";

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
		.filter((part) => part.length > 0)
		.map((part) => part[0].toUpperCase() + part.slice(1))
		.join("");
};

const to_constant_case = (name: string): string => {
	return name.replace(/-/g, "_").toUpperCase();
};

const rollout_block_for = (mode: RolloutMode): string => {
	if (mode === "atomic") return `\trollout: { type: "atomic" },`;
	return `\trollout: {\n\t\ttype: "gradual",\n\t\t// Override stages here, e.g. { name: "onebox", traffic: 5, bake: "1h" }.\n\t\t// Omitted stages keep their defaultGradual values.\n\t\tstages: [],\n\t},`;
};

const gates_block_for = (mode: RolloutMode, gate: DefaultGateKind): string => {
	if (mode === "atomic") {
		if (gate === "manual") return `\tgates: {\n\t\t"staging→atomic-prod": manual(),\n\t},`;
		if (gate === "auto") return `\tgates: {\n\t\t"staging→atomic-prod": auto(),\n\t},`;
		return `\tgates: {\n\t\t"staging→atomic-prod": analysis({ template_id: "default" }),\n\t},`;
	}
	const gate_call =
		gate === "manual"
			? "manual()"
			: gate === "auto"
				? "auto({ afterBake: true })"
				: `analysis({ template_id: "default" })`;
	return `\tgates: {\n\t\t"staging→onebox": ${gate_call},\n\t\t"onebox→wave1": ${gate_call},\n\t\t"wave1→wave2": ${gate_call},\n\t\t"wave2→full": ${gate_call},\n\t},`;
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
		build_shape: input.build_shape,
		rollout_block: rollout_block_for(input.rollout),
		gates_block: gates_block_for(input.rollout, input.default_gate),
		gate_import: gate_import_for(input.default_gate),
	};
};

const PLACEHOLDER_PATTERN = /\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/gi;
const IF_ELSE_BLOCK_PATTERN =
	/\{\{#if\s+\(eq\s+([a-z_][a-z0-9_]*)\s+"([^"]*)"\)\s*\}\}([\s\S]*?)\{\{else\}\}([\s\S]*?)\{\{\/if\}\}/g;
const IF_BLOCK_PATTERN = /\{\{#if\s+\(eq\s+([a-z_][a-z0-9_]*)\s+"([^"]*)"\)\s*\}\}([\s\S]*?)\{\{\/if\}\}/g;

/**
 * Handlebars-style `{{name}}` substitution with support for `{{#if (eq var "value")}}...{{/if}}` and
 * `{{#if (eq var "value")}}...{{else}}...{{/if}}` blocks.
 * Returns `err(missing_var)` if the template references a key absent from `vars` — fail loudly rather
 * than silently emitting `undefined`.
 */
export const render_template = (template: string, vars: Record<string, string>): Result<string, RenderError> => {
	// First, collect all variable references (both in placeholders and in conditionals)
	const all_matches: Array<{ full: string; key: string; index: number }> = [];

	// Find placeholder variables (exclude template syntax like if/else/endif)
	const placeholder_matches = template.matchAll(PLACEHOLDER_PATTERN);
	for (const match of placeholder_matches) {
		const key = match[1];
		// Skip template syntax keywords
		if (!["if", "else", "endif"].includes(key.toLowerCase())) {
			all_matches.push({ full: match[0], key, index: match.index ?? 0 });
		}
	}

	// Find variables in if-else conditions
	for (const match of template.matchAll(IF_ELSE_BLOCK_PATTERN)) {
		const key = match[1];
		all_matches.push({ full: match[0], key, index: match.index ?? 0 });
	}

	// Find variables in if conditions (without else)
	for (const match of template.matchAll(IF_BLOCK_PATTERN)) {
		const key = match[1];
		all_matches.push({ full: match[0], key, index: match.index ?? 0 });
	}

	// Check for missing variables
	const missing = all_matches.find((m) => !(m.key in vars));
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

	// Process if-else blocks first (must come before simple if blocks)
	let result = template.replace(
		IF_ELSE_BLOCK_PATTERN,
		(_, key: string, value: string, true_content: string, false_content: string) => {
			const var_value = vars[key];
			return var_value === value ? true_content : false_content;
		},
	);

	// Process simple if blocks
	result = result.replace(IF_BLOCK_PATTERN, (_, key: string, value: string, content: string) => {
		const var_value = vars[key];
		return var_value === value ? content : "";
	});

	// Process simple placeholders
	result = result.replace(PLACEHOLDER_PATTERN, (_, key: string) => vars[key]);

	return ok(result);
};
