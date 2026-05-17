import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import * as yaml from "js-yaml";

describe("github-actions-template", () => {
	test("template file exists", () => {
		const template_path = new URL("../src/scaffolder/templates/.github/workflows/deploy.yml.hbs", import.meta.url);
		const template = readFileSync(template_path, "utf8");
		expect(template).toContain("name: deploy");
		expect(template).toContain("{{package_name}}");
	});

	test("renders with sample package name", () => {
		const template_path = new URL("../src/scaffolder/templates/.github/workflows/deploy.yml.hbs", import.meta.url);
		const template = readFileSync(template_path, "utf8");

		// Simple handlebars replacement
		const rendered = template.replace(/{{package_name}}/g, "test-package");

		// Verify YAML is valid
		expect(() => yaml.load(rendered)).not.toThrow();

		const parsed = yaml.load(rendered) as any;
		expect(parsed).toBeDefined();
		expect(parsed.name).toBe("deploy");
		expect(parsed.on).toBeDefined();
		expect(parsed.jobs).toBeDefined();
	});

	test("workflow has correct job structure", () => {
		const template_path = new URL("../src/scaffolder/templates/.github/workflows/deploy.yml.hbs", import.meta.url);
		const template = readFileSync(template_path, "utf8");
		const rendered = template.replace(/{{package_name}}/g, "test-package");

		const parsed = yaml.load(rendered) as any;

		expect(parsed.jobs).toHaveProperty("build");
		expect(parsed.jobs.build).toBeDefined();
		expect(parsed.jobs.build.steps).toBeDefined();
	});

	test("build job includes all required steps", () => {
		const template_path = new URL("../src/scaffolder/templates/.github/workflows/deploy.yml.hbs", import.meta.url);
		const template = readFileSync(template_path, "utf8");
		const rendered = template.replace(/{{package_name}}/g, "test-package");

		const parsed = yaml.load(rendered) as any;
		const steps = parsed.jobs.build.steps;
		const step_names = steps.map((s: any) => s.name || s.uses || s.run);

		expect(step_names.some((n: any) => String(n).includes("checkout"))).toBe(true);
		expect(step_names.some((n: any) => String(n).includes("setup-bun"))).toBe(true);
		expect(step_names.some((n: any) => String(n).includes("install"))).toBe(true);
		expect(step_names.some((n: any) => String(n).includes("test"))).toBe(true);
		expect(step_names.some((n: any) => String(n).includes("Build worker bundle"))).toBe(true);
		expect(step_names.some((n: any) => String(n).includes("Upload artifacts"))).toBe(true);
		expect(step_names.some((n: any) => String(n).includes("Versions upload"))).toBe(true);
		expect(step_names.some((n: any) => String(n).includes("Start pipeline run"))).toBe(true);
	});

	test("upload step references correct artifact paths", () => {
		const template_path = new URL("../src/scaffolder/templates/.github/workflows/deploy.yml.hbs", import.meta.url);
		const template = readFileSync(template_path, "utf8");

		expect(template).toContain("dist/_worker.js");
		expect(template).toContain("dist/manifest.json");
		expect(template).toContain("infra.ts");
		expect(template).toContain("pipeline.ts");
		expect(template).toContain("grants.ts");
	});

	test("upload step outputs version_set_id", () => {
		const template_path = new URL("../src/scaffolder/templates/.github/workflows/deploy.yml.hbs", import.meta.url);
		const template = readFileSync(template_path, "utf8");
		const rendered = template.replace(/{{package_name}}/g, "test-package");

		const parsed = yaml.load(rendered) as any;
		const upload_step = parsed.jobs.build.steps.find((s: any) => s.id === "upload");

		expect(upload_step).toBeDefined();
		expect(upload_step.run).toContain("version-set.json");
		expect(upload_step.run).toContain("version_set_id");
	});

	test("versions upload step does not include deploy command", () => {
		const template_path = new URL("../src/scaffolder/templates/.github/workflows/deploy.yml.hbs", import.meta.url);
		const template = readFileSync(template_path, "utf8");

		// versions-upload should only do "versions upload", not "deploy"
		expect(template).toContain("versions upload");
		expect(template).not.toContain("wrangler deploy");
		expect(template).not.toContain("versions deploy");
	});

	test("start-run step conditionally runs on main branch", () => {
		const template_path = new URL("../src/scaffolder/templates/.github/workflows/deploy.yml.hbs", import.meta.url);
		const template = readFileSync(template_path, "utf8");
		const rendered = template.replace(/{{package_name}}/g, "test-package");

		const parsed = yaml.load(rendered) as any;
		const start_run_step = parsed.jobs.build.steps.find((s: any) => s.name === "Start pipeline run");

		expect(start_run_step).toBeDefined();
		expect(start_run_step.if).toContain("main");
	});

	test("credentials are injected via GitHub secrets", () => {
		const template_path = new URL("../src/scaffolder/templates/.github/workflows/deploy.yml.hbs", import.meta.url);
		const template = readFileSync(template_path, "utf8");

		expect(template).toContain("CLOUDFLARE_API_TOKEN");
		expect(template).toContain("CLOUDFLARE_ACCOUNT_ID");
		expect(template).toContain("DEVPAD_API_KEY");
	});

	test("template uses correct handlebars syntax", () => {
		const template_path = new URL("../src/scaffolder/templates/.github/workflows/deploy.yml.hbs", import.meta.url);
		const template = readFileSync(template_path, "utf8");

		const hbs_pattern = /{{[a-z_]+}}/g;
		const placeholders = template.match(hbs_pattern);

		expect(placeholders).toContain("{{package_name}}");
	});

	test("artifact upload uses correct CLI syntax", () => {
		const template_path = new URL("../src/scaffolder/templates/.github/workflows/deploy.yml.hbs", import.meta.url);
		const template = readFileSync(template_path, "utf8");

		// The published @devpad/cli does not yet ship pipelines support, so
		// the workflow runs the CLI from a cloned source tree. Anchor on the
		// `pipelines artifacts upload` invocation rather than the runner.
		expect(template).toContain("pipelines artifacts upload");
		expect(template).toContain("packages/cli/src/index.ts");
		expect(template).toContain("--package");
		expect(template).toContain("--bundle");
		expect(template).toContain("--manifest");
		expect(template).toContain("--infra-plan");
		expect(template).toContain("--pipeline");
		expect(template).toContain("--grants");
		expect(template).toContain("--output");
	});

	test("runs-start uses correct invocation", () => {
		const template_path = new URL("../src/scaffolder/templates/.github/workflows/deploy.yml.hbs", import.meta.url);
		const template = readFileSync(template_path, "utf8");

		// The "start a run" step POSTs to the orchestrator directly so it
		// works without an authenticated devpad API key in CI.
		expect(template).toContain("DEVPAD_PIPELINES_URL");
		expect(template).toContain("/runs");
		expect(template).toContain("package_id");
		expect(template).toContain("version_set_id");
	});

	test("handles environment variable defaults", () => {
		const template_path = new URL("../src/scaffolder/templates/.github/workflows/deploy.yml.hbs", import.meta.url);
		const template = readFileSync(template_path, "utf8");

		// DEVPAD_BASE_URL should have a default (artifacts upload still uses it)
		expect(template).toContain("DEVPAD_BASE_URL || 'https://devpad.tools/api/v1'");
		// DEVPAD_PIPELINES_URL should fall back to the production orchestrator URL
		expect(template).toContain("DEVPAD_PIPELINES_URL || 'https://devpad-pipelines.dev-818.workers.dev'");
	});
});
