import { describe, expect, test } from "bun:test";
import type { AssetUpload, ModuleUpload } from "../src/cloudflare-provider.ts";
import { InMemoryCloudflareProvider } from "../src/in-memory-cloudflare.ts";

const upload_two = async (cf: InMemoryCloudflareProvider, script: string) => {
	const v1 = await cf.versions.upload({ kind: "single_file", script_name: script });
	const v2 = await cf.versions.upload({ kind: "single_file", script_name: script });
	if (!v1.ok || !v2.ok) throw new Error("upload failed");
	return [v1.value, v2.value] as const;
};

describe("InMemoryCloudflareProvider — happy paths", () => {
	test("uploads versions and lists them in order", async () => {
		const cf = new InMemoryCloudflareProvider();
		const [v1, v2] = await upload_two(cf, "worker-a");

		expect(v1.number).toBe(1);
		expect(v2.number).toBe(2);

		const list = await cf.versions.list("worker-a");
		if (!list.ok) throw new Error("list failed");
		expect(list.value.map(v => v.id)).toEqual([v1.id, v2.id]);
	});

	test("creates a single atomic 100% deployment", async () => {
		const cf = new InMemoryCloudflareProvider();
		const [v1] = await upload_two(cf, "worker-a");

		const deploy = await cf.deployments.create({
			script_name: "worker-a",
			strategy: { strategy: "percentage", versions: [{ version_id: v1.id, percentage: 100 }] },
		});
		expect(deploy.ok).toBe(true);
		cf.assertPercentageSum();
	});

	test("creates a gradual deployment split 10/90", async () => {
		const cf = new InMemoryCloudflareProvider();
		const [v1, v2] = await upload_two(cf, "worker-a");

		const deploy = await cf.deployments.create({
			script_name: "worker-a",
			strategy: {
				strategy: "percentage",
				versions: [
					{ version_id: v1.id, percentage: 90 },
					{ version_id: v2.id, percentage: 10 },
				],
			},
		});
		expect(deploy.ok).toBe(true);
		cf.assertPercentageSum();
		expect(cf.get_active_deployment("worker-a")?.strategy.versions).toHaveLength(2);
	});
});

describe("InMemoryCloudflareProvider — invariants", () => {
	test("rejects deployment whose percentages do not sum to 100", async () => {
		const cf = new InMemoryCloudflareProvider();
		const [v1, v2] = await upload_two(cf, "worker-a");

		const deploy = await cf.deployments.create({
			script_name: "worker-a",
			strategy: {
				strategy: "percentage",
				versions: [
					{ version_id: v1.id, percentage: 80 },
					{ version_id: v2.id, percentage: 10 },
				],
			},
		});
		if (deploy.ok) throw new Error("expected validation error");
		expect(deploy.error.code).toBe("validation");
		expect(deploy.error.message).toContain("100");
	});

	test("rejects deployment referencing an unknown version", async () => {
		const cf = new InMemoryCloudflareProvider();
		await upload_two(cf, "worker-a");

		const deploy = await cf.deployments.create({
			script_name: "worker-a",
			strategy: { strategy: "percentage", versions: [{ version_id: "version_unknown", percentage: 100 }] },
		});
		if (deploy.ok) throw new Error("expected not_found");
		expect(deploy.error.code).toBe("not_found");
	});

	test("workers.get returns not_found for unknown script", async () => {
		const cf = new InMemoryCloudflareProvider();
		const get = await cf.workers.get("ghost");
		if (get.ok) throw new Error("expected not_found");
		expect(get.error.code).toBe("not_found");
	});

	test("assert_version_key_header_routed resolves via Transform Rule registration", async () => {
		const cf = new InMemoryCloudflareProvider();
		const [v1] = await upload_two(cf, "worker-a");
		cf.register_version_key("worker-a", "preview-tom", v1.id);

		const routed = await cf.assert_version_key_header_routed({ script_name: "worker-a", version_key: "preview-tom" });
		if (!routed.ok) throw new Error(`expected routed: ${routed.error.message}`);
		expect(routed.value.resolved_version_id).toBe(v1.id);

		const missing = await cf.assert_version_key_header_routed({ script_name: "worker-a", version_key: "unknown" });
		if (missing.ok) throw new Error("expected not_found");
		expect(missing.error.code).toBe("not_found");
	});

	test("assertPercentageSum throws on a corrupted deployment", async () => {
		const cf = new InMemoryCloudflareProvider();
		const [v1] = await upload_two(cf, "worker-a");
		await cf.deployments.create({
			script_name: "worker-a",
			strategy: { strategy: "percentage", versions: [{ version_id: v1.id, percentage: 100 }] },
		});

		// simulate corruption by mutating the active deployment
		const active = cf.get_active_deployment("worker-a");
		if (!active) throw new Error("no active deployment");
		active.strategy.versions[0].percentage = 80;

		expect(() => cf.assertPercentageSum()).toThrow(/sum to 80/);
	});
});

const make_modules = (): ModuleUpload[] => [
	{ name: "index.js", mime_type: "application/javascript+module", content: new TextEncoder().encode("export default {};") },
	{ name: "chunks/foo.mjs", mime_type: "application/javascript+module", content: new TextEncoder().encode("export {};") },
];

const make_assets = (): AssetUpload[] => [
	{ path: "/_astro/index.css", hash: "0123456789abcdef0123456789abcdef", size_bytes: 4, mime_type: "text/css", content: new TextEncoder().encode("body") },
	{ path: "/index.html", hash: "fedcba9876543210fedcba9876543210", size_bytes: 5, mime_type: "text/html", content: new TextEncoder().encode("<html") },
];

describe("InMemoryCloudflareProvider — directory_bundle uploads", () => {
	test("records every module on the version", async () => {
		const cf = new InMemoryCloudflareProvider();
		const result = await cf.versions.upload({
			kind: "directory_bundle",
			script_name: "astro-app",
			modules: make_modules(),
			main_module: "index.js",
			compatibility_date: "2026-05-01",
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		cf.assertVersionHasModules("astro-app", result.value.id, ["index.js", "chunks/foo.mjs"]);
	});

	test("rejects directory_bundle whose main_module is not in modules", async () => {
		const cf = new InMemoryCloudflareProvider();
		const result = await cf.versions.upload({
			kind: "directory_bundle",
			script_name: "astro-app",
			modules: make_modules(),
			main_module: "nope.js",
			compatibility_date: "2026-05-01",
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code).toBe("validation");
	});

	test("rejects an asset whose hash is not 32 chars", async () => {
		const cf = new InMemoryCloudflareProvider();
		const result = await cf.versions.upload({
			kind: "directory_bundle",
			script_name: "astro-app",
			modules: make_modules(),
			main_module: "index.js",
			compatibility_date: "2026-05-01",
			assets: {
				assets: [{ path: "/foo.css", hash: "shorthash", size_bytes: 3, mime_type: "text/css", content: new TextEncoder().encode("foo") }],
			},
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code).toBe("validation");
	});

	test("records asset paths when an assets bundle is provided", async () => {
		const cf = new InMemoryCloudflareProvider();
		const result = await cf.versions.upload({
			kind: "directory_bundle",
			script_name: "astro-app",
			modules: make_modules(),
			main_module: "index.js",
			compatibility_date: "2026-05-01",
			assets: { assets: make_assets() },
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		cf.assertVersionHasAssets("astro-app", result.value.id, ["/_astro/index.css", "/index.html"]);
	});

	test("assertVersionHasAssets throws when assets are missing", async () => {
		const cf = new InMemoryCloudflareProvider();
		const result = await cf.versions.upload({
			kind: "directory_bundle",
			script_name: "astro-app",
			modules: make_modules(),
			main_module: "index.js",
			compatibility_date: "2026-05-01",
		});
		if (!result.ok) throw new Error("upload failed");
		expect(() => cf.assertVersionHasAssets("astro-app", result.value.id, ["/anything"])).toThrow(/no assets/);
	});

	test("single_file + directory_bundle uploads on the same script share version numbering", async () => {
		const cf = new InMemoryCloudflareProvider();
		const a = await cf.versions.upload({ kind: "single_file", script_name: "mixed" });
		const b = await cf.versions.upload({
			kind: "directory_bundle",
			script_name: "mixed",
			modules: make_modules(),
			main_module: "index.js",
			compatibility_date: "2026-05-01",
		});
		if (!a.ok || !b.ok) throw new Error("upload failed");
		expect(a.value.number).toBe(1);
		expect(b.value.number).toBe(2);

		const list = await cf.versions.list("mixed");
		if (!list.ok) throw new Error("list failed");
		expect(list.value).toHaveLength(2);
		// First version is single-file → no modules; second is directory_bundle → has modules.
		expect(list.value[0].modules).toBeUndefined();
		expect(list.value[1].modules?.length).toBe(2);
	});
});
