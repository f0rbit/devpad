import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

describe("scaffolder wrangler.jsonc template", () => {
	const template_path = join(import.meta.dir, "../src/scaffolder/templates/wrangler.jsonc.hbs");

	test("template file exists", () => {
		expect(() => readFileSync(template_path, "utf-8")).not.toThrow();
	});

	test("template parses as valid JSON when placeholders are substituted", () => {
		const template_content = readFileSync(template_path, "utf-8");

		// Simple handlebars substitution
		const rendered = template_content
			.replace(/{{package_name}}/g, "test-package")
			.replace(/{{compatibility_date}}/g, "2026-05-17");

		// Remove comments (jsonc → json)
		const json_only = rendered
			.split("\n")
			.filter(line => !line.trim().startsWith("//"))
			.join("\n");

		expect(() => JSON.parse(json_only)).not.toThrow();
	});

	test("rendered template has required bindings", () => {
		const template_content = readFileSync(template_path, "utf-8");
		const rendered = template_content
			.replace(/{{package_name}}/g, "test-package")
			.replace(/{{compatibility_date}}/g, "2026-05-17");

		const json_only = rendered
			.split("\n")
			.filter(line => !line.trim().startsWith("//"))
			.join("\n");

		const config = JSON.parse(json_only);

		// Verify ANTHROPIC binding exists with entrypoint
		const anthropic_binding = config.services.find(
			(s: { binding: string }) => s.binding === "ANTHROPIC",
		);
		expect(anthropic_binding).toBeDefined();
		expect(anthropic_binding?.entrypoint).toBe("AnthropicVault");
		// Platform services (vault, pulse) are singletons — both stages of
		// the scaffolded Worker bind to the same upstream Worker. Stage
		// scoping is enforced via `caller.environment` on the RPC identity
		// arg and on pulse event tags.
		expect(anthropic_binding?.service).toBe("vault-production");

		// Verify PULSE binding exists (singleton)
		const pulse_binding = config.services.find(
			(s: { binding: string }) => s.binding === "PULSE",
		);
		expect(pulse_binding).toBeDefined();
		expect(pulse_binding?.service).toBe("pulse-api-production");
	});

	test("rendered template has staging/production env blocks", () => {
		const template_content = readFileSync(template_path, "utf-8");
		const rendered = template_content
			.replace(/{{package_name}}/g, "test-package")
			.replace(/{{compatibility_date}}/g, "2026-05-17");

		const json_only = rendered
			.split("\n")
			.filter(line => !line.trim().startsWith("//"))
			.join("\n");

		const config = JSON.parse(json_only);

		expect(config.env.staging).toBeDefined();
		expect(config.env.staging.name).toBe("test-package-staging");
		expect(config.env.production).toBeDefined();
		expect(config.env.production.name).toBe("test-package");
	});

	test("template includes nodejs_compat flag (rpc is default since 2024-04-03)", () => {
		const template_content = readFileSync(template_path, "utf-8");
		const rendered = template_content
			.replace(/{{package_name}}/g, "test-package")
			.replace(/{{compatibility_date}}/g, "2026-05-17");

		const json_only = rendered
			.split("\n")
			.filter(line => !line.trim().startsWith("//"))
			.join("\n");

		const config = JSON.parse(json_only);

		expect(config.compatibility_flags).toContain("nodejs_compat");
		// `rpc` is a default compat flag since 2024-04-03 and Cloudflare
		// rejects a deploy that specifies it explicitly — keep it out.
		expect(config.compatibility_flags).not.toContain("rpc");
	});
});
