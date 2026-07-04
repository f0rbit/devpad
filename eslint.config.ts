import { define_lint_config } from "@f0rbit/lint";

export default define_lint_config({
	naming: "camelCase",
	tsconfig_root_dir: import.meta.dirname,
	overrides: [
		{
			// Golden fixtures are scaffolder OUTPUT snapshots asserted byte-for-byte by
			// packages/cli's tests -- each ships its own full lint toolchain wiring
			// (own eslint.config.ts/tsconfig.json). Linting them from the root would
			// double-lint against the wrong project graph.
			ignores: ["packages/cli/tests/golden/**"],
		},
		{
			// Handlebars template stubs (*.hbs) for `devpad pipelines init` scaffolding.
			// The ts_files glob only matches real .ts/.tsx extensions so this is a
			// no-op in practice; listed explicitly so the scope boundary is documented.
			ignores: ["packages/pipeline-templates/src/scaffolder/templates/**"],
		},
		{
			// oxlint/typescript-eslint don't parse Astro -- apps/{main,blog,media}
			// pages stay out of scope for this toolchain until upstream Astro support
			// exists. The ts_files glob already excludes *.astro naturally (ESLint
			// flat config only applies rules to matched files); this entry documents
			// the boundary explicitly rather than relying on that being silent.
			ignores: ["**/*.astro"],
		},
		{
			// Known projectService coverage gaps -- these files aren't `include`d by
			// ANY tsconfig.json in the workspace, so typed linting hard-errors on them
			// ("was not found by the project service") rather than reporting content
			// violations. Pre-existing structural gaps, not something this wiring pass
			// fixes -- each needs a dedicated test/config tsconfig as follow-up work:
			//  - packages/api/tests/**  : packages/api/tsconfig.json excludes "tests"
			//    entirely (its rootDir: "./src" also means these can't just be added
			//    to the existing include -- they live outside rootDir).
			//  - packages/core/src/**/__tests__/** : packages/core/tsconfig.json
			//    excludes "**/*.test.ts" (~35 files, includes the pipelines domain
			//    suite -- the single biggest coverage gap found).
			//  - tests/e2e/** : Playwright specs/fixtures, no tsconfig exists for this
			//    directory at all (separate test runner from bun test).
			//  - packages/api/tsup.config.ts, packages/schema/drizzle.config.ts :
			//    single root-level config files outside their package's rootDir:
			//    "./src" -- adding them to `include` would trip a rootDir violation.
			// See AGENTS.md lint/format section and the wiring PR body survey.
			ignores: [
				"packages/api/tests/**",
				"packages/core/src/**/__tests__/**",
				"tests/e2e/**",
				"packages/api/tsup.config.ts",
				"packages/schema/drizzle.config.ts",
			],
		},
		{
			// PipelinesGrantsEndpoint is the Cloudflare Worker RPC entrypoint vault
			// binds to via `services[].entrypoint` -- WorkerEntrypoint is Cloudflare's
			// mandated base class, no functional-style escape hatch. Same precedent as
			// the scaffolder template's src/index.ts override.
			files: ["packages/pipelines/src/grants-rpc-entrypoint.ts"],
			rules: {
				"functional/no-classes": "off",
				"functional/no-this-expressions": "off",
			},
		},
		{
			// PipelineRunDO is the Durable Object class wrangler binds to -- Cloudflare
			// mandates a class with a constructor(ctx, env) signature for DO bindings,
			// same class of platform-mandated exception as WorkerEntrypoint above.
			files: ["packages/pipelines/src/index.ts"],
			rules: {
				"functional/no-classes": "off",
				"functional/no-this-expressions": "off",
			},
		},
		{
			// ApiError extends Error so callers get correct `instanceof Error`
			// semantics -- same precedent as corpus's CoverageError (testing/cover.ts).
			files: ["packages/api/src/errors.ts"],
			rules: {
				"functional/no-classes": "off",
				"functional/no-this-expressions": "off",
			},
		},
	],
});
