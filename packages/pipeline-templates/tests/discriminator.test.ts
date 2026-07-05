import { describe, expect, test } from "bun:test";
import type { VersionSetManifest } from "@f0rbit/corpus";
import { resolve_rollout } from "../src/discriminator";
import { defaultAtomic, defaultGradual } from "../src/index";
import type { ForcedAtomicReason, Rollout } from "../src/types";

const make_manifest = (opts: {
	has_do_migrations: boolean;
	has_assets: boolean;
	version_affinity: "pinned" | "none";
}): VersionSetManifest => ({
	package: "test-package",
	git_sha: "0".repeat(40),
	created_at: "2026-05-16T00:00:00.000Z",
	builds: {
		worker: {
			artifact_ref: "worker-bundles/abc",
			size_bytes: 1024,
			compatibility_date: "2025-01-01",
		},
		assets: opts.has_assets
			? {
					artifact_ref: "assets/xyz",
					version_affinity: opts.version_affinity,
				}
			: undefined,
	},
	migrations: {
		do_migrations: opts.has_do_migrations
			? [
					{
						class_name: "MyDO",
						tag: "v1",
						kind: "new_sqlite_classes" as const,
					},
				]
			: [],
	},
	env_manifest_ref: "env-manifests/qqq",
	infra_plan_ref: "infra-plans/rrr",
});

type Row = {
	declared: "gradual" | "atomic";
	do_migrations: boolean;
	has_assets: boolean;
	affinity: "pinned" | "none";
	expected_type: "gradual" | "atomic";
	expected_reason: ForcedAtomicReason | null;
};

// 16 cases: 2 declared × 2 do_migrations × 2 has_assets × 2 affinity.
// Precedence: do_migrations wins, then asset_affinity_none, else honour declared.
const rows: Row[] = [
	// declared = gradual
	{
		declared: "gradual",
		do_migrations: false,
		has_assets: false,
		affinity: "pinned",
		expected_type: "gradual",
		expected_reason: null,
	},
	{
		declared: "gradual",
		do_migrations: false,
		has_assets: false,
		affinity: "none",
		expected_type: "gradual",
		expected_reason: null,
	},
	{
		declared: "gradual",
		do_migrations: false,
		has_assets: true,
		affinity: "pinned",
		expected_type: "gradual",
		expected_reason: null,
	},
	{
		declared: "gradual",
		do_migrations: false,
		has_assets: true,
		affinity: "none",
		expected_type: "atomic",
		expected_reason: "asset_affinity_none",
	},
	{
		declared: "gradual",
		do_migrations: true,
		has_assets: false,
		affinity: "pinned",
		expected_type: "atomic",
		expected_reason: "do_migrations",
	},
	{
		declared: "gradual",
		do_migrations: true,
		has_assets: false,
		affinity: "none",
		expected_type: "atomic",
		expected_reason: "do_migrations",
	},
	{
		declared: "gradual",
		do_migrations: true,
		has_assets: true,
		affinity: "pinned",
		expected_type: "atomic",
		expected_reason: "do_migrations",
	},
	{
		declared: "gradual",
		do_migrations: true,
		has_assets: true,
		affinity: "none",
		expected_type: "atomic",
		expected_reason: "do_migrations",
	},
	// declared = atomic — already safe, no forcing reason
	{
		declared: "atomic",
		do_migrations: false,
		has_assets: false,
		affinity: "pinned",
		expected_type: "atomic",
		expected_reason: null,
	},
	{
		declared: "atomic",
		do_migrations: false,
		has_assets: false,
		affinity: "none",
		expected_type: "atomic",
		expected_reason: null,
	},
	{
		declared: "atomic",
		do_migrations: false,
		has_assets: true,
		affinity: "pinned",
		expected_type: "atomic",
		expected_reason: null,
	},
	{
		declared: "atomic",
		do_migrations: false,
		has_assets: true,
		affinity: "none",
		expected_type: "atomic",
		expected_reason: null,
	},
	{
		declared: "atomic",
		do_migrations: true,
		has_assets: false,
		affinity: "pinned",
		expected_type: "atomic",
		expected_reason: null,
	},
	{
		declared: "atomic",
		do_migrations: true,
		has_assets: false,
		affinity: "none",
		expected_type: "atomic",
		expected_reason: null,
	},
	{
		declared: "atomic",
		do_migrations: true,
		has_assets: true,
		affinity: "pinned",
		expected_type: "atomic",
		expected_reason: null,
	},
	{
		declared: "atomic",
		do_migrations: true,
		has_assets: true,
		affinity: "none",
		expected_type: "atomic",
		expected_reason: null,
	},
];

describe("resolve_rollout", () => {
	for (const row of rows) {
		const label = `declared=${row.declared} do=${String(row.do_migrations)} assets=${String(row.has_assets)} affinity=${row.affinity}`;
		test(label, () => {
			const declared: Rollout = row.declared === "gradual" ? defaultGradual : defaultAtomic;
			const manifest = make_manifest({
				has_do_migrations: row.do_migrations,
				has_assets: row.has_assets,
				version_affinity: row.affinity,
			});
			const result = resolve_rollout(declared, manifest);
			expect(result.rollout.type).toBe(row.expected_type);
			expect(result.forced_reason).toBe(row.expected_reason);
		});
	}

	test("preserves declared gradual stages when not forced", () => {
		const manifest = make_manifest({
			has_do_migrations: false,
			has_assets: false,
			version_affinity: "pinned",
		});
		const result = resolve_rollout(defaultGradual, manifest);
		expect(result.rollout).toEqual(defaultGradual);
	});

	test("returns the atomic singleton (no extra fields) when forcing", () => {
		const manifest = make_manifest({
			has_do_migrations: true,
			has_assets: false,
			version_affinity: "pinned",
		});
		const result = resolve_rollout(defaultGradual, manifest);
		expect(result.rollout).toEqual({ type: "atomic" });
	});
});
