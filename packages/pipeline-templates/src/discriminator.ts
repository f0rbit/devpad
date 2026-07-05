/**
 * @module pipeline-templates/discriminator
 *
 * Resolves the effective rollout shape for a run at start time. The
 * package declares a {@link Rollout} in `pipeline.ts`, but the
 * version-set manifest can force `atomic` for two safety reasons:
 *
 * 1. **DO migrations.** `migrations.do_migrations` non-empty means the
 *    new version brings Durable Object schema changes; running a
 *    percentage rollout would put two incompatible DO versions live
 *    against the same storage.
 * 2. **Unaffinitised assets.** Static assets without `pinned` affinity
 *    cannot be split across two live worker versions — a percentage
 *    rollout would serve stale asset references.
 *
 * Both checks return the same atomic shape but a different
 * {@link ForcedAtomicReason} so the UI / pulse can surface why the
 * declared shape was overridden. The function is pure: same inputs
 * always produce the same outputs.
 */

import type { VersionSetManifest } from "@f0rbit/corpus";
import type { ForcedAtomicReason, Rollout } from "./types";

export type ResolvedRollout = {
	rollout: Rollout;
	forced_reason: ForcedAtomicReason | null;
};

const atomic: Rollout = { type: "atomic" };

/**
 * Discriminate the effective rollout for a run.
 *
 * Rule precedence (first match wins):
 * 1. DO migrations non-empty → atomic, reason `do_migrations`
 * 2. Assets present with `version_affinity = "none"` → atomic, reason `asset_affinity_none`
 * 3. Otherwise honour the declared rollout, no forcing
 *
 * If a force-rule fires but the declared rollout was already `atomic`,
 * the result is still atomic and `forced_reason` is null — nothing was
 * forced, the user already chose the safe shape.
 */
export const resolve_rollout = (declared: Rollout, manifest: VersionSetManifest): ResolvedRollout => {
	const has_do_migrations = manifest.migrations.do_migrations.length > 0;
	const assets_no_affinity = manifest.builds.assets !== undefined && manifest.builds.assets.version_affinity === "none";

	if (has_do_migrations) {
		return {
			rollout: atomic,
			forced_reason: declared.type === "atomic" ? null : "do_migrations",
		};
	}
	if (assets_no_affinity) {
		return {
			rollout: atomic,
			forced_reason: declared.type === "atomic" ? null : "asset_affinity_none",
		};
	}
	return { rollout: declared, forced_reason: null };
};
