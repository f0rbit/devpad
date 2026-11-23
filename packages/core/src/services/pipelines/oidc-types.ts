/**
 * @module core/services/pipelines/oidc-types
 *
 * Types + Zod schemas + pure helpers for the GitHub Actions OIDC trust
 * exchange. Lives separately from `oidc.ts` so the production verifier
 * and the in-memory test verifier can both import the wire shapes
 * without pulling in the orchestration logic.
 *
 * Three layers:
 *
 * - `OidcSubject` — the parsed `sub` claim, narrowed into a discriminated
 *   union per the formats GitHub Actions emits today (branch / tag / PR /
 *   environment). Used as a cross-check against `repository` /
 *   `repository_owner` claims; the trust matcher operates on the
 *   structured claims, not on raw `sub` strings.
 * - `VerifiedOidcClaims` — the Zod-validated payload returned by the JWT
 *   verifier. Standard claims (`iss`, `aud`, `exp`, ...) are validated by
 *   `jose.jwtVerify`; the GitHub-specific claims are validated here.
 * - `OidcSessionClaims` — what the orchestrator-signed HS256 session JWT
 *   carries. Routes consume this via the auth middleware.
 */

import { err, ok, type Result } from "@f0rbit/corpus";
import { z } from "zod";

// ─── OidcSubject ────────────────────────────────────────────────────

export type OidcSubject =
	| {
			kind: "branch";
			owner: string;
			repo: string;
			branch: string;
			owner_id?: string;
			repo_id?: string;
	  }
	| {
			kind: "tag";
			owner: string;
			repo: string;
			tag: string;
			owner_id?: string;
			repo_id?: string;
	  }
	| {
			kind: "pull_request";
			owner: string;
			repo: string;
			owner_id?: string;
			repo_id?: string;
	  }
	| {
			kind: "environment";
			owner: string;
			repo: string;
			environment: string;
			owner_id?: string;
			repo_id?: string;
	  };

export type SubjectParseError = { kind: "subject_parse_failed"; sub: string; reason: string };

const SUB_REPO_PREFIX = "repo:";

/**
 * Split an optional immutable-subject id suffix off a `sub` segment.
 * GitHub's immutable subject format appends `@<numeric_id>` to both the
 * owner and the repo segments (`repo:o@123/r@456:...`); the plain
 * format has no suffix. Only `@` followed by ONLY digits is an id —
 * any other `@` usage is a parse error, not a name character.
 */
const split_segment_id = (segment: string): Result<{ name: string; id?: string }, string> => {
	const at = segment.indexOf("@");
	if (at === -1) return ok({ name: segment });
	const name = segment.slice(0, at);
	const id = segment.slice(at + 1);
	if (id === "" || !/^\d+$/.test(id)) return err(`'@' suffix must be digits, got '${id}'`);
	return ok({ name, id });
};

/**
 * Parse a GitHub Actions OIDC `sub` claim into a typed `OidcSubject`.
 * Accepts the four documented plain formats:
 *
 * - `repo:<owner>/<repo>:ref:refs/heads/<branch>`
 * - `repo:<owner>/<repo>:ref:refs/tags/<tag>`
 * - `repo:<owner>/<repo>:pull_request`
 * - `repo:<owner>/<repo>:environment:<env>`
 *
 * plus the immutable-subject variants of all four, where BOTH segments
 * carry a `@<numeric_id>` suffix (`repo:<owner>@<owner_id>/<repo>@<repo_id>:...`)
 * and `repository` / `repository_owner` claims stay plain. When the
 * immutable form is used the parsed result carries `owner_id` / `repo_id`
 * so the exchange cross-check can bind them to the token's
 * `repository_id` / `repository_owner_id` claims.
 *
 * Returns `err` for any other shape — the trust matcher refuses to act
 * on a `sub` it can't classify.
 */
export const parse_oidc_subject = (sub: string): Result<OidcSubject, SubjectParseError> => {
	if (!sub.startsWith(SUB_REPO_PREFIX)) {
		return err({ kind: "subject_parse_failed", sub, reason: "missing 'repo:' prefix" });
	}
	const rest = sub.slice(SUB_REPO_PREFIX.length);
	const first_colon = rest.indexOf(":");
	if (first_colon === -1)
		return err({ kind: "subject_parse_failed", sub, reason: "missing context after '<owner>/<repo>'" });
	const repo_full = rest.slice(0, first_colon);
	const context = rest.slice(first_colon + 1);
	const slash = repo_full.indexOf("/");
	if (slash === -1) return err({ kind: "subject_parse_failed", sub, reason: "expected '<owner>/<repo>'" });
	const owner_segment = repo_full.slice(0, slash);
	const repo_segment = repo_full.slice(slash + 1);
	const owner_split = split_segment_id(owner_segment);
	if (!owner_split.ok)
		return err({ kind: "subject_parse_failed", sub, reason: `invalid owner segment: ${owner_split.error}` });
	const repo_split = split_segment_id(repo_segment);
	if (!repo_split.ok)
		return err({ kind: "subject_parse_failed", sub, reason: `invalid repo segment: ${repo_split.error}` });
	const owner = owner_split.value.name;
	const repo = repo_split.value.name;
	if (owner === "" || repo === "") return err({ kind: "subject_parse_failed", sub, reason: "empty owner or repo" });

	const subject_ids = (): { owner_id?: string; repo_id?: string } => ({
		...(owner_split.value.id !== undefined ? { owner_id: owner_split.value.id } : {}),
		...(repo_split.value.id !== undefined ? { repo_id: repo_split.value.id } : {}),
	});

	if (context === "pull_request") return ok({ kind: "pull_request", owner, repo, ...subject_ids() });
	if (context.startsWith("ref:refs/heads/")) {
		const branch = context.slice("ref:refs/heads/".length);
		if (branch === "") return err({ kind: "subject_parse_failed", sub, reason: "empty branch" });
		return ok({ kind: "branch", owner, repo, branch, ...subject_ids() });
	}
	if (context.startsWith("ref:refs/tags/")) {
		const tag = context.slice("ref:refs/tags/".length);
		if (tag === "") return err({ kind: "subject_parse_failed", sub, reason: "empty tag" });
		return ok({ kind: "tag", owner, repo, tag, ...subject_ids() });
	}
	if (context.startsWith("environment:")) {
		const environment = context.slice("environment:".length);
		if (environment === "") return err({ kind: "subject_parse_failed", sub, reason: "empty environment" });
		return ok({ kind: "environment", owner, repo, environment, ...subject_ids() });
	}
	return err({ kind: "subject_parse_failed", sub, reason: `unrecognised context '${context}'` });
};

// ─── VerifiedOidcClaims (post-jose payload validation) ──────────────

/**
 * The shape of a GitHub Actions OIDC token payload after `jose.jwtVerify`
 * has validated `iss`/`aud`/`exp`/`iat`/`nbf`. We re-validate the
 * GitHub-specific claims here so downstream code reads typed fields.
 *
 * Informational fields are kept (`actor`, `workflow`, etc.) so the
 * session token can carry them for audit.
 */
export const verified_oidc_claims_schema = z.object({
	iss: z.literal("https://token.actions.githubusercontent.com"),
	aud: z.string().min(1),
	exp: z.number().int(),
	iat: z.number().int(),
	jti: z.string().optional(),
	sub: z.string().min(1),
	repository: z.string().regex(/^[^/]+\/[^/]+$/, "repository must be '<owner>/<repo>'"),
	repository_owner: z.string().min(1),
	repository_id: z.string().min(1).optional(),
	repository_owner_id: z.string().min(1).optional(),
	ref: z.string().optional(),
	environment: z.string().optional(),
	event_name: z.string().optional(),
	actor: z.string().optional(),
	workflow: z.string().optional(),
	workflow_ref: z.string().optional(),
	run_id: z.union([z.string(), z.number()]).optional(),
	run_attempt: z.union([z.string(), z.number()]).optional(),
	sha: z.string().optional(),
});

export type VerifiedOidcClaims = z.infer<typeof verified_oidc_claims_schema>;

// ─── OidcSessionClaims (HS256 orchestrator-signed) ──────────────────

export const OIDC_SESSION_SCOPES = [
	"artifacts:upload",
	"packages:write",
	"runs:cancel",
	"runs:events",
	"runs:rollback",
	"runs:start",
] as const;
export type OidcSessionScope = (typeof OIDC_SESSION_SCOPES)[number];

export type OidcAudit = {
	sub: string;
	repository: string;
	ref: string | null;
	sha: string | null;
	run_id: string | null;
	actor: string | null;
};

export type OidcSessionClaims = {
	iss: "devpad-pipelines";
	aud: "devpad-pipelines";
	exp: number;
	iat: number;
	jti: string;
	sub: `package:${string}` | `owner:${string}`;
	scope: OidcSessionScope[];
	package_ids: string[];
	trust_policy_id: string;
	oidc: OidcAudit;
};

// ─── Exchange wire types ────────────────────────────────────────────

export type OidcExchangeInput = {
	jwt: string;
	package_id?: string;
	requested_scope?: string[];
};

export type OidcExchangeOutput = {
	session_token: string;
	expires_at: Date;
	scope: OidcSessionScope[];
	package_ids: string[];
	trust_policy_id: string;
};

export type OidcExchangeError =
	| { kind: "invalid_request"; message: string }
	| { kind: "invalid_oidc_token"; reason: string }
	| { kind: "trust_policy_failed"; reason: string }
	| { kind: "package_not_found"; package_id: string }
	| { kind: "package_scope_mismatch"; package_id: string; claimed_repo: string; declared_repo: string | null }
	| { kind: "db_error"; message: string }
	| { kind: "auth_unavailable"; message: string };

// ─── Glob → RegExp compiler ─────────────────────────────────────────

/**
 * Convert a single-segment glob to a regex. Supports `*` (any run),
 * `?` (single char), and `[...]` character classes. No `**` — we only
 * match short names (`<repo>`), not paths.
 *
 * The compiled regex is anchored (`^...$`) so a pattern like `forbit-*`
 * doesn't accidentally match `forbit-x-foo` as a substring.
 */
export const compile_glob = (pattern: string): RegExp => {
	let out = "^";
	let i = 0;
	while (i < pattern.length) {
		const ch = pattern[i];
		if (ch === "*") {
			out += ".*";
			i += 1;
			continue;
		}
		if (ch === "?") {
			out += ".";
			i += 1;
			continue;
		}
		if (ch === "[") {
			// pass character class through verbatim (jose-style glob accepts [a-z])
			const close = pattern.indexOf("]", i + 1);
			if (close === -1) {
				out += "\\[";
				i += 1;
				continue;
			}
			out += pattern.slice(i, close + 1);
			i = close + 1;
			continue;
		}
		// escape regex metacharacters
		if ("\\^$.|+(){}".indexOf(ch) !== -1) {
			out += "\\" + ch;
		} else {
			out += ch;
		}
		i += 1;
	}
	out += "$";
	return new RegExp(out, "i"); // case-insensitive — github owners/repos are case-insensitive
};
