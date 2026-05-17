/**
 * @module pipeline-templates/scaffolder/manifest
 *
 * Deterministic, sorted manifest of every template file the scaffolder
 * emits, plus the relative path each template maps to in the generated
 * package. Source-of-truth for the golden-test snapshotter; also drives
 * the side-effect orchestrator's write loop.
 *
 * Keep `relative_path` sorted lexicographically — the golden test relies
 * on this ordering to compare directory trees deterministically.
 */

export type TemplateEntry = {
	/** Path under `packages/pipeline-templates/src/scaffolder/templates/`. */
	template_path: string;
	/** Path inside the generated package, relative to its root. */
	relative_path: string;
};

export const SCAFFOLDER_TEMPLATES: TemplateEntry[] = [
	{ template_path: ".github/workflows/deploy.yml.hbs", relative_path: ".github/workflows/deploy.yml" },
	{ template_path: ".gitignore.hbs", relative_path: ".gitignore" },
	{ template_path: "AGENTS.md.hbs", relative_path: "AGENTS.md" },
	{ template_path: "README.md.hbs", relative_path: "README.md" },
	{ template_path: "e2e/health.spec.ts.hbs", relative_path: "e2e/health.spec.ts" },
	{ template_path: "e2e/playwright.config.ts.hbs", relative_path: "e2e/playwright.config.ts" },
	{ template_path: "grants.ts.hbs", relative_path: "grants.ts" },
	{ template_path: "infra.ts.hbs", relative_path: "infra.ts" },
	{ template_path: "package.json.hbs", relative_path: "package.json" },
	{ template_path: "pipeline.ts.hbs", relative_path: "pipeline.ts" },
	{ template_path: "src/env.ts.hbs", relative_path: "src/env.ts" },
	{ template_path: "src/index.ts.hbs", relative_path: "src/index.ts" },
	{ template_path: "tsconfig.json.hbs", relative_path: "tsconfig.json" },
	{ template_path: "types/pipeline-templates.d.ts.hbs", relative_path: "types/pipeline-templates.d.ts" },
	{ template_path: "wrangler.jsonc.hbs", relative_path: "wrangler.jsonc" },
];
