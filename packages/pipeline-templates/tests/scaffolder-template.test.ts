import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const template_path = join(import.meta.dir, "../src/scaffolder/templates/wrangler.jsonc.hbs");

const render_config = (package_name: string, compatibility_date: string): unknown => {
	const template_content = readFileSync(template_path, "utf-8");
	const rendered = template_content
		.replace(/{{package_name}}/g, package_name)
		.replace(/{{compatibility_date}}/g, compatibility_date);

	// Remove comments (jsonc → json) and trailing commas — oxfmt's canonical
	// formatting adds trailing commas to .jsonc files (unlike plain .json),
	// which plain JSON.parse rejects.
	const json_only = rendered
		.split("\n")
		.filter((line) => !line.trim().startsWith("//"))
		.join("\n")
		.replace(/,(\s*[}\]])/g, "$1");

	return JSON.parse(json_only);
};

describe("scaffolder wrangler.jsonc template", () => {
	test("template file exists", () => {
		expect(() => readFileSync(template_path, "utf-8")).not.toThrow();
	});

	test("template parses as valid JSON when placeholders are substituted", () => {
		expect(() => render_config("test-package", "2026-05-17")).not.toThrow();
	});

	test("rendered template has required bindings", () => {
		const config = render_config("test-package", "2026-05-17") as {
			services: Array<{ binding: string; service: string; entrypoint?: string }>;
		};

		// Verify ANTHROPIC binding exists with entrypoint
		const anthropic_binding = config.services.find((s) => s.binding === "ANTHROPIC");
		expect(anthropic_binding).toBeDefined();
		expect(anthropic_binding?.entrypoint).toBe("AnthropicVault");
		// Platform services (vault, pulse) are singletons — both stages of
		// the scaffolded Worker bind to the same upstream Worker. Stage
		// scoping is enforced via `caller.environment` on the RPC identity
		// arg and on pulse event tags.
		expect(anthropic_binding?.service).toBe("vault");

		// Verify PULSE binding exists (singleton)
		const pulse_binding = config.services.find((s) => s.binding === "PULSE");
		expect(pulse_binding).toBeDefined();
		expect(pulse_binding?.service).toBe("pulse-api");
	});

	test("rendered template has staging/production env blocks", () => {
		const config = render_config("test-package", "2026-05-17") as {
			env: { staging: { name: string }; production: { name: string } };
		};

		expect(config.env.staging).toBeDefined();
		expect(config.env.staging.name).toBe("test-package-staging");
		expect(config.env.production).toBeDefined();
		expect(config.env.production.name).toBe("test-package");
	});

	test("template includes nodejs_compat flag (rpc is default since 2024-04-03)", () => {
		const config = render_config("test-package", "2026-05-17") as { compatibility_flags: string[] };

		expect(config.compatibility_flags).toContain("nodejs_compat");
		// `rpc` is a default compat flag since 2024-04-03 and Cloudflare
		// rejects a deploy that specifies it explicitly — keep it out.
		expect(config.compatibility_flags).not.toContain("rpc");
	});
});
