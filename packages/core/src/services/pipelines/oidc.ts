/**
 * @module core/services/pipelines/oidc
 *
 * Pure business logic for the GitHub Actions OIDC trust exchange.
 *
 * The orchestrator's `POST /auth/github-oidc` route forwards every
 * exchange request here. The flow is:
 *
 * 1. `verify_oidc(jwt)` — injected dep. Production wraps `jose.jwtVerify`
 *    against the GitHub JWKS; tests use an in-memory fake. Returns a
 *    `VerifiedOidcClaims` Zod-validated payload.
 * 2. `match_trust_policy(claims, policies)` — walks the trust policies
 *    in descending `created_at` order, returning the first policy that
 *    matches `repository_owner` + `repo_pattern` glob + optional refs /
 *    environments. Empty arrays on the policy mean "wildcard".
 * 3. `validate_package_binding(package, claims)` — extracts `<owner>/<repo>`
 *    from `package.repo_url` and case-insensitively compares to
 *    `claims.repository`. If `repo_url` is null we reject — the package
 *    must declare its source repo.
 * 4. `sign_session(claims)` — injected dep. Production HS256-signs with
 *    the `OIDC_SESSION_SIGNING_KEY` secret; tests sign with a fake
 *    string. Returns the wire token.
 *
 * Every error returns a typed `Result`; no throws. The error union is
 * declared in `oidc-types.ts` so wire mapping at the route boundary can
 * exhaust the `kind` discriminator.
 */

import type { PipelineOidcTrust, PipelinePackage } from "@devpad/schema";
import { pipeline_oidc_trust, pipeline_package } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { err, ok, type Result } from "@f0rbit/corpus";
import { desc, eq } from "drizzle-orm";
import {
	compile_glob,
	OIDC_SESSION_SCOPES,
	type OidcAudit,
	type OidcExchangeError,
	type OidcExchangeInput,
	type OidcExchangeOutput,
	type OidcSessionClaims,
	type OidcSessionScope,
	parse_oidc_subject,
	type VerifiedOidcClaims,
} from "./oidc-types.js";

// ─── Trust policy matching ──────────────────────────────────────────

export type TrustMatchError = { kind: "no_matching_policy"; reason: string };

export type MatchedPolicy = {
	policy: PipelineOidcTrust;
	granted_scope: OidcSessionScope[];
};

const repo_basename = (repository: string): string => {
	const slash = repository.indexOf("/");
	return slash === -1 ? repository : repository.slice(slash + 1);
};

const has_wildcard = (list: string[] | null | undefined): boolean =>
	list === null || list === undefined || list.length === 0;

const list_includes_ci = (list: string[], value: string): boolean =>
	list.some((item) => item.toLowerCase() === value.toLowerCase());

/**
 * First-match-wins. The caller should pre-sort `policies` by
 * `created_at DESC` then `id ASC` for determinism — the DB query in
 * `load_trust_policies` does this.
 */
export const match_trust_policy = (
	claims: VerifiedOidcClaims,
	policies: PipelineOidcTrust[],
): Result<MatchedPolicy, TrustMatchError> => {
	if (policies.length === 0) return err({ kind: "no_matching_policy", reason: "no trust policies configured" });

	const owner = claims.repository_owner.toLowerCase();
	const repo = repo_basename(claims.repository).toLowerCase();

	for (const policy of policies) {
		if (policy.expected_audience !== claims.aud) continue;
		if (policy.github_owner.toLowerCase() !== owner) continue;

		const repo_regex = compile_glob(policy.repo_pattern);
		if (!repo_regex.test(repo)) continue;

		const allowed_refs = policy.allowed_refs;
		if (!has_wildcard(allowed_refs)) {
			if (claims.ref === undefined) continue;
			if (!list_includes_ci(allowed_refs, claims.ref)) continue;
		}

		const allowed_envs = policy.allowed_environments;
		if (!has_wildcard(allowed_envs)) {
			// When the policy requires a specific environment, the claim
			// must carry one and it must be in the allowlist.
			if (claims.environment === undefined) continue;
			if (!list_includes_ci(allowed_envs, claims.environment)) continue;
		}

		const allowed_actions = policy.allowed_actions as OidcSessionScope[];
		return ok({ policy, granted_scope: allowed_actions });
	}

	return err({ kind: "no_matching_policy", reason: `no policy matches ${claims.repository_owner}/${repo}` });
};

// ─── Package binding validation ─────────────────────────────────────

export type PackageBindingError =
	| { kind: "repo_url_missing"; package_id: string }
	| { kind: "repo_url_unparseable"; package_id: string; repo_url: string }
	| { kind: "repo_mismatch"; package_id: string; claimed_repo: string; declared_repo: string };

const GITHUB_REPO_URL_PATTERN = /github\.com[/:]+([^/]+)\/([^/.\s]+?)(?:\.git)?\/?$/i;

/**
 * Extract `<owner>/<repo>` from a `repo_url` value. We accept both
 * https (`https://github.com/<owner>/<repo>(.git)?`) and ssh
 * (`git@github.com:<owner>/<repo>(.git)?`) forms because both show up in
 * the wild.
 */
export const extract_repo_from_url = (repo_url: string): string | null => {
	const m = repo_url.match(GITHUB_REPO_URL_PATTERN);
	if (m === null) return null;
	const owner = m[1];
	const repo = m[2];
	if (!owner || !repo) return null;
	return `${owner}/${repo}`;
};

export const validate_package_binding = (
	pkg: PipelinePackage,
	claims: VerifiedOidcClaims,
): Result<void, PackageBindingError> => {
	if (pkg.repo_url === null || pkg.repo_url === "") {
		return err({ kind: "repo_url_missing", package_id: pkg.id });
	}
	const declared = extract_repo_from_url(pkg.repo_url);
	if (declared === null) {
		return err({ kind: "repo_url_unparseable", package_id: pkg.id, repo_url: pkg.repo_url });
	}
	if (declared.toLowerCase() !== claims.repository.toLowerCase()) {
		return err({ kind: "repo_mismatch", package_id: pkg.id, claimed_repo: claims.repository, declared_repo: declared });
	}
	return ok(undefined);
};

// ─── Deps + orchestration ───────────────────────────────────────────

export type OidcExchangeDeps = {
	db: Database;
	verify_oidc: (jwt: string) => Promise<Result<VerifiedOidcClaims, { reason: string }>>;
	sign_session: (claims: OidcSessionClaims) => Promise<Result<string, { reason: string }>>;
	now: () => Date;
	new_jti: () => string;
};

const load_trust_policies = async (db: Database, owner: string): Promise<PipelineOidcTrust[]> => {
	const rows = await db
		.select()
		.from(pipeline_oidc_trust)
		.where(eq(pipeline_oidc_trust.provider, "github"))
		.orderBy(desc(pipeline_oidc_trust.created_at), pipeline_oidc_trust.id);
	// Filter to policies owned by anyone with a matching `github_owner` — the
	// trust matcher then narrows further. Owner-scoping (per-user-id) is a
	// future ACL extension; for now any policy can match.
	return rows.filter((p) => p.github_owner.toLowerCase() === owner.toLowerCase());
};

const intersect_scope = (granted: OidcSessionScope[], requested: string[] | undefined): OidcSessionScope[] => {
	const known: ReadonlySet<OidcSessionScope> = new Set(OIDC_SESSION_SCOPES);
	if (requested === undefined || requested.length === 0) return granted;
	const requested_set = new Set(requested.filter((s): s is OidcSessionScope => known.has(s as OidcSessionScope)));
	return granted.filter((s) => requested_set.has(s));
};

const build_audit = (claims: VerifiedOidcClaims): OidcAudit => ({
	sub: claims.sub,
	repository: claims.repository,
	ref: claims.ref ?? null,
	sha: claims.sha ?? null,
	run_id: claims.run_id !== undefined ? String(claims.run_id) : null,
	actor: claims.actor ?? null,
});

const touch_last_used = async (db: Database, policy_id: string, when: Date): Promise<void> => {
	try {
		await db
			.update(pipeline_oidc_trust)
			.set({ last_used_at: when.toISOString() })
			.where(eq(pipeline_oidc_trust.id, policy_id));
	} catch {
		// Audit field — never block the exchange if this fails.
	}
};

/**
 * Exchange a GitHub OIDC JWT for an orchestrator-signed session token.
 *
 * Steps map 1:1 to the public error union — every `kind` is unreachable
 * from a single concrete code path so the route layer can map them
 * directly into wire codes.
 */
export const exchange_oidc_for_session = async (
	deps: OidcExchangeDeps,
	input: OidcExchangeInput,
): Promise<Result<OidcExchangeOutput, OidcExchangeError>> => {
	if (typeof input.jwt !== "string" || input.jwt === "") {
		return err({ kind: "invalid_request", message: "jwt is required" });
	}

	const verified = await deps.verify_oidc(input.jwt);
	if (!verified.ok) return err({ kind: "invalid_oidc_token", reason: verified.error.reason });

	const claims = verified.value;

	// Cross-check the parsed `sub` agrees with `repository` / `repository_owner`.
	// This catches a forged claim where the structured fields disagree.
	const subject = parse_oidc_subject(claims.sub);
	if (subject.ok) {
		const subj = subject.value;
		const subj_repo_full = `${subj.owner}/${subj.repo}`.toLowerCase();
		if (subj_repo_full !== claims.repository.toLowerCase()) {
			return err({
				kind: "invalid_oidc_token",
				reason: `sub repository '${subj_repo_full}' disagrees with claim 'repository' '${claims.repository}'`,
			});
		}
		if (subj.owner.toLowerCase() !== claims.repository_owner.toLowerCase()) {
			return err({ kind: "invalid_oidc_token", reason: `sub owner disagrees with claim 'repository_owner'` });
		}
	}

	// Trust policy lookup + match
	let policies: PipelineOidcTrust[];
	try {
		policies = await load_trust_policies(deps.db, claims.repository_owner);
	} catch (e) {
		return err({ kind: "db_error", message: `failed to load trust policies: ${String(e)}` });
	}

	const matched = match_trust_policy(claims, policies);
	if (!matched.ok) return err({ kind: "trust_policy_failed", reason: matched.error.reason });

	const { policy, granted_scope } = matched.value;
	const final_scope = intersect_scope(granted_scope, input.requested_scope);

	// Package scoping
	let package_ids: string[] = [];
	let session_sub: OidcSessionClaims["sub"] = `owner:${policy.owner_id}`;
	if (typeof input.package_id === "string" && input.package_id !== "") {
		let pkg: PipelinePackage | undefined;
		try {
			const rows = await deps.db.select().from(pipeline_package).where(eq(pipeline_package.id, input.package_id));
			pkg = rows.at(0);
		} catch (e) {
			return err({ kind: "db_error", message: `failed to load pipeline_package: ${String(e)}` });
		}
		if (pkg === undefined) return err({ kind: "package_not_found", package_id: input.package_id });

		const binding = validate_package_binding(pkg, claims);
		if (!binding.ok) {
			const e = binding.error;
			const claimed_repo = claims.repository;
			const declared_repo =
				e.kind === "repo_url_missing" ? null : e.kind === "repo_url_unparseable" ? null : e.declared_repo;
			return err({ kind: "package_scope_mismatch", package_id: input.package_id, claimed_repo, declared_repo });
		}
		package_ids = [pkg.id];
		session_sub = `package:${pkg.id}`;
	}

	// Mint the session
	const now = deps.now();
	const iat = Math.floor(now.getTime() / 1000);
	const exp = iat + policy.session_ttl_seconds;
	const session: OidcSessionClaims = {
		iss: "devpad-pipelines",
		aud: "devpad-pipelines",
		iat,
		exp,
		jti: deps.new_jti(),
		sub: session_sub,
		scope: final_scope,
		package_ids,
		trust_policy_id: policy.id,
		oidc: build_audit(claims),
	};

	const signed = await deps.sign_session(session);
	if (!signed.ok) return err({ kind: "auth_unavailable", message: signed.error.reason });

	await touch_last_used(deps.db, policy.id, now);

	return ok({
		session_token: signed.value,
		expires_at: new Date(exp * 1000),
		scope: final_scope,
		package_ids,
		trust_policy_id: policy.id,
	});
};
