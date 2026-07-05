import { define_lint_config } from "@f0rbit/lint";

export default define_lint_config({
	naming: "snake_case",
	tsconfig_root_dir: import.meta.dirname,
	// devpad writes extensionless relative imports throughout (Vite/Astro apps,
	// tsup-built packages) -- the ecosystem-standard bundler convention, not the
	// Node-ESM "every relative import needs .js" rule. See lint's own AGENTS.md
	// on the module_resolution option (added 0.1.4 specifically for this case).
	module_resolution: "bundler",
	overrides: [
		{
			// --- Rule tiers (fix/lint-gate PR) ---
			// devpad is mid-migration from camelCase to snake_case naming (user
			// decision, phased separately -- see AGENTS.md) and carries substantial
			// pre-toolchain debt in unsafe-* boundary typing, class-based provider
			// code, and raw try/catch/throw. None of these are "off" -- they stay
			// visible in CI/editor output at warn severity and graduate back to
			// error incrementally, package by package, as each is cleaned up.
			// Distribution was checked before tiering (post-bump/post-flip survey,
			// PR body): every rule below hits 6+ top-level packages/apps roughly
			// evenly (tests/, core, worker, cli, api, mcp, pipelines*, apps/*) --
			// none is concentrated enough to scope narrower than repo-wide.
			//   - naming-convention: tracked by devpad task
			//     task_77589418-c5e0-4f8f-8864-713d5199085f
			//   - no-unsafe-{assignment,member-access,argument,call,return} +
			//     functional/no-this-expressions + functional/no-classes: tracked by
			//     task_ed8646a5-97e8-41a8-b279-317fe5b210bd
			//   - functional/no-throw-statements + no-try-statements: this family
			//     wasn't in the original wiring-PR's top-5 list (dominated at the
			//     time by naming-convention/unsafe-*) but the post-bump survey found
			//     it at 327+243 -- a real architectural migration to Result
			//     combinators, not a mechanical fix. Tracked by
			//     task_90024e9a-6d3a-4ebc-8134-55ff2c5f3616
			// f0rbit/must-use-result is deliberately NOT here -- it stays error and
			// every baseline violation was fixed in this PR (real discarded-Result
			// bugs, not a style debt bucket).
			// --- @f0rbit/lint 0.1.5 -> 0.3.0 rollout (chore/lint-030) ---
			// f0rbit/no-ambient-effects and f0rbit/prefer-pipe ship warn-tier by
			// factory default in 0.2.0/0.3.0 -- no override needed here to SET the
			// tier, they're already warn. Appended to this SAME graduation
			// mechanism (real devpad tasks, not a new ad-hoc list):
			//   - f0rbit/no-ambient-effects (236 baseline hits): graduates to error
			//     once packages designate clock/rng provider modules via
			//     ambient_effect_files (pulse phase-3 precedent). Tracked by
			//     task_20d205a2-5c6d-40a2-a9af-e47940a6dba2
			//   - f0rbit/prefer-pipe (15 baseline hits): needs manual per-site
			//     pipe() composition, not mechanical. Tracked by
			//     task_093e3f71-2291-4f2e-99ce-2e8392793187
			// f0rbit/require-schema-at-boundary, no-console, and
			// consistent-type-definitions (0.2.0/0.3.0 error-tier additions) were
			// fixed for real in this rollout -- no override, no exceptions beyond
			// the scoped ones below (env.d.ts, CLI output modules, etc.).
			// `files` must be scoped to ts_files: an unscoped rules-only override
			// applies to every file the flat config sees (including plain .js
			// scripts), and those never get the @typescript-eslint plugin
			// registered (that only happens inside the ts_files-scoped typed
			// family) -- ESLint errors "could not find plugin" without this.
			files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
			rules: {
				"@typescript-eslint/naming-convention": "warn",
				"@typescript-eslint/no-unsafe-assignment": "warn",
				"@typescript-eslint/no-unsafe-member-access": "warn",
				"@typescript-eslint/no-unsafe-argument": "warn",
				"@typescript-eslint/no-unsafe-call": "warn",
				"@typescript-eslint/no-unsafe-return": "warn",
				"functional/no-this-expressions": "warn",
				"functional/no-classes": "warn",
				"functional/no-throw-statements": "warn",
				"functional/no-try-statements": "warn",
			},
		},
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
		{
			// import-x's bundler-mode resolver (createNodeResolver) has no
			// tsconfig-paths awareness -- it can't resolve `@/*` alias specifiers
			// at all (see ~/dev/lint AGENTS.md gotcha on why the factory doesn't
			// ship eslint-import-resolver-typescript). Verified empirically: an
			// unresolvable `@/` specifier fails import-x/extensions BOTH with and
			// without an explicit extension, so no per-import fix exists -- only
			// these three apps' src/** trees use the `@/*` alias pervasively.
			// Real relative-import extension checking elsewhere is unaffected.
			files: ["apps/main/src/**", "apps/blog/src/**", "apps/media/src/**"],
			rules: {
				"import-x/extensions": "off",
			},
		},
		{
			// @modelcontextprotocol/sdk ships real Node-ESM with a mandatory `.js`
			// extension in its package exports map. Bundler mode's `pattern`
			// override applies "never" to `.js` unconditionally, including bare
			// package specifiers -- there's no per-import escape from the
			// generated pattern, so this one file (the only mcp-sdk import site)
			// gets a narrow exception rather than disabling the rule package-wide.
			files: ["packages/mcp/src/index.ts"],
			rules: {
				"import-x/extensions": "off",
			},
		},
		{
			// The MCP SDK's own JSDoc on `Server` says "Only use `Server` for
			// advanced use cases" (custom request handlers, dynamic tool list) --
			// exactly this file's usage (DevpadMCPServer wires up custom
			// ListTools/CallTool handlers). Migrating to `McpServer.registerTool`
			// is a real behavioral rewrite, not a mechanical fix -- deferred
			// rather than done blind during the fix/lint-gate lint pass.
			files: ["packages/mcp/src/index.ts"],
			rules: {
				"@typescript-eslint/no-deprecated": "off",
			},
		},
		{
			// expect_ok<T>(body): T is a test-only response-unwrapping cast helper
			// called with an explicit <T> at 20+ sites across this file. T only
			// appears in the return position structurally, which
			// no-unnecessary-type-parameters flags, but de-genericizing it would
			// push an `as T` to every call site -- strictly worse ergonomics for
			// identical type safety.
			files: ["packages/pipelines/__tests__/integration/orchestrator-routes.test.ts"],
			rules: {
				"@typescript-eslint/no-unnecessary-type-parameters": "off",
			},
		},
		{
			// env.d.ts files are ambient Astro/Vite declaration-merging targets
			// (`declare global { namespace App { interface Locals } } }`,
			// `interface ImportMetaEnv`). typescript-eslint's --fix for
			// consistent-type-definitions returns null on interfaces nested in
			// `declare global` (upstream #2707 -- can't safely rewrite ambient
			// merged declarations), so those three still error unless silenced
			// here. apps/main/src/env.d.ts uses `declare namespace App` without
			// the `declare global` wrapper, so the ambient-guard technically
			// doesn't catch it and --fix WOULD mechanically rewrite it to a type
			// alias -- but that risks breaking Astro's own Locals merge-target
			// contract without a compile error surfacing immediately. All three
			// are silenced consistently rather than relying on that asymmetry.
			files: ["**/env.d.ts"],
			rules: {
				"@typescript-eslint/consistent-type-definitions": "off",
			},
		},
		{
			// --- no-console overrides (@f0rbit/lint 0.2.0 wave) ---
			// packages/cli is a CLI: index.ts (bootstrap banner + top-level error
			// reporting), printer.ts (its own docstring: "Shared TTY-aware output
			// helpers"), commands/pipelines.ts (all user-facing command output),
			// and corpus-http-backend.ts (best-effort shadow-write warnings during
			// the corpus migration, logged and continued rather than failed) are
			// all genuine terminal UX, not application logging -- scoped to these
			// specific output modules, not the whole package.
			files: [
				"packages/cli/src/index.ts",
				"packages/cli/src/printer.ts",
				"packages/cli/src/commands/**",
				"packages/cli/src/corpus-http-backend.ts",
			],
			rules: {
				"no-console": "off",
			},
		},
		{
			// packages/cli's own tests: packages-commands.test.ts and
			// oidc-trust-cli.test.ts monkey-patch console.log/console.error to
			// capture CLI output into buffers for assertions (no-console flags
			// the property reads, not just the calls); scaffold-init-golden.test.ts
			// prints a confirmation when regenerating golden fixtures
			// (UPDATE_GOLDENS=1); compile-pipeline.test.ts prints the raw error
			// before an `expect(result.ok).toBe(true)` that would otherwise hide it.
			// All four are test-diagnostic output, not app logging debt.
			files: ["packages/cli/tests/**"],
			rules: {
				"no-console": "off",
			},
		},
		{
			// packages/core/src/utils/logger.ts is the createLogger() wrapper --
			// the sanctioned structured-logging channel call sites import instead
			// of calling console.* directly (see packages/core/src/services/media/**
			// for ~19 existing consumers, and the pipelines/grants.ts +
			// pipelines/gates/analysis.ts fixes in this same wave). The wrapper
			// itself is the one place console.* is legitimately called.
			files: ["packages/core/src/utils/logger.ts"],
			rules: {
				"no-console": "off",
			},
		},
		{
			// packages/schema/src/errors.ts's defaultLogger is the built-in
			// console-based implementation of the pluggable ErrorLogFn --
			// consumers override via configureErrorLogging() when they have a
			// real channel (see apps/media/src/utils/error-logger.ts below).
			files: ["packages/schema/src/errors.ts"],
			rules: {
				"no-console": "off",
			},
		},
		{
			// packages/api/src/request.ts's console.log calls are ApiClient's own
			// opt-in `debug` constructor option (gated behind `this.debug`), not
			// unconditional logging -- explicit opt-in debug tooling, not app
			// logging debt.
			files: ["packages/api/src/request.ts"],
			rules: {
				"no-console": "off",
			},
		},
		{
			// packages/mcp/src/index.ts is a stdio MCP server -- stdout carries
			// JSON-RPC framing, so console.error (stderr) is the only place this
			// process can legitimately report its own status/errors. Permanent,
			// not debt.
			files: ["packages/mcp/src/index.ts"],
			rules: {
				"no-console": "off",
			},
		},
		{
			// packages/worker/src/index.ts's one remaining console.error is the
			// Astro-handler-threw catch in createUnifiedWorker's top-level fetch --
			// it runs outside any Hono request context (no `c.get("log")` available
			// there), so it's the only signal this crash gets short of wiring pulse
			// through the raw Worker fetch handler. packages/worker/src/local.ts's
			// console.error is a bun-native local-dev bootstrap check (fatal
			// config error before process.exit), the same class as a CLI startup
			// error, not a Cloudflare-deployed code path.
			files: ["packages/worker/src/index.ts", "packages/worker/src/local.ts"],
			rules: {
				"no-console": "off",
			},
		},
		{
			// scripts/build-unified.ts is a build script -- console.log/error is
			// its user-facing terminal progress output (`bun run build:worker`),
			// the same class as the CLI's output modules above.
			files: ["scripts/build-unified.ts"],
			rules: {
				"no-console": "off",
			},
		},
		{
			// tests/integration/**'s pre-existing "soft-skip" pattern: several
			// integration suites console.warn a diagnostic ("X endpoint not
			// implemented"/"X failed, status: ...") and return early instead of
			// hard-failing when a route isn't wired up yet in the local test
			// server. tests/shared/test-utils.ts's `log()` is the analogous
			// DEBUG_LOGGING-gated helper. Pre-existing test-diagnostics
			// convention, not application logging debt -- not migrated to avoid
			// changing which soft-skips are visible in default (non-DEBUG_LOGGING)
			// CI output.
			files: ["tests/integration/**", "tests/shared/test-utils.ts"],
			rules: {
				"no-console": "off",
			},
		},
		{
			// apps/main/src/lib/pulse.ts exports a browser `log` namespace
			// (mirrors packages/worker/src/lib/log.ts on the server side) --
			// components import `log.error`/`log.warning` from "@/lib/pulse"
			// instead of calling console.* directly (see update-diff.tsx,
			// tag-editor.tsx, task-status.ts, task-sorter.tsx, task-editor.tsx,
			// config-editor.tsx, task-card.tsx, goal-selector.tsx,
			// goal-quick-form.tsx in this same wave). No override needed for
			// apps/main -- every call site was migrated for real.
			//
			// apps/blog and apps/media have no equivalent client-side pulse
			// wiring yet, so their handful of `console.error("[Component] ...")`
			// catch-block logs and (for media) the ErrorLogFn default
			// implementation stay as scoped overrides until one gets built.
			files: [
				"apps/blog/src/components/post/project-selector.tsx",
				"apps/blog/src/components/post/post-editor.tsx",
				"apps/media/src/utils/error-logger.ts",
				"apps/media/src/components/solid/profile-selector.tsx",
				"apps/media/src/components/solid/profile-list.tsx",
				"apps/media/src/components/solid/PlatformSettings/you-tube-settings.tsx",
				"apps/media/src/components/solid/PlatformSettings/use-settings.ts",
				"apps/media/src/components/solid/PlatformSettings/devpad-settings.tsx",
				"apps/media/src/components/solid/PlatformSettings/bluesky-settings.tsx",
			],
			rules: {
				"no-console": "off",
			},
		},
	],
});
