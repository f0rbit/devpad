/**
 * @module core/services/pipelines/oidc-trust
 *
 * Trust policy CRUD for the OIDC-trust subsystem (Phase 15). A trust
 * policy authorises a `repository_owner` (and optionally narrows by
 * `repo_pattern` / refs / environments) to mint short-lived session
 * tokens via {@link exchange_oidc_for_session} (15.A). Policies live in
 * `pipeline_oidc_trust` (15.0 schema).
 *
 * Surface:
 *
 * - `list_trust_policies` — owner-scoped listing, ordered to match the
 *   trust matcher (`created_at DESC, id ASC`) used by 15.A.
 * - `get_trust_policy` — read one by id; `not_found` when missing or
 *   when it belongs to a different owner.
 * - `create_trust_policy` — Zod-validated insert. Defaults match plan
 *   §I.5: `repo_pattern: "*"`, `allowed_actions:
 *   ["artifacts:upload","runs:start"]`.
 * - `update_trust_policy` — partial patch (Zod-validated). Owner-scoped.
 * - `delete_trust_policy` — soft delete (sets `deleted = true`); the
 *   entity convention keeps the row for audit.
 * - `touch_trust_policy_last_used` — bumps `last_used_at`; called by
 *   the 15.A exchange route after a successful exchange.
 *
 * No throws. Result-typed throughout. Owner scoping is enforced at the
 * service layer — routes pass `owner_id` along with the policy id.
 */

import type { PipelineOidcTrust, UpsertPipelineOidcTrust } from "@devpad/schema";
import { pipeline_oidc_trust } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { upsert_pipeline_oidc_trust } from "@devpad/schema/validation";
import { err, ok, type Result } from "@f0rbit/corpus";
import { and, asc, desc, eq } from "drizzle-orm";
import type { ServiceError } from "../errors.js";

const DEFAULT_REPO_PATTERN = "*";
const DEFAULT_ALLOWED_ACTIONS = ["artifacts:upload", "runs:start"] as const;
const DEFAULT_SESSION_TTL_SECONDS = 900;

export type ListTrustPoliciesFilter = {
	owner_id: string;
};

/**
 * List the caller's trust policies. Ordered `created_at DESC, id ASC`
 * to match the trust-matcher's deterministic ordering in 15.A —
 * keeping the two in sync means the management UI shows the same
 * policy at the top that the matcher would resolve first.
 */
export const list_trust_policies = async (
	db: Database,
	filter: ListTrustPoliciesFilter,
): Promise<Result<PipelineOidcTrust[], ServiceError>> => {
	try {
		const rows = await db
			.select()
			.from(pipeline_oidc_trust)
			.where(and(eq(pipeline_oidc_trust.owner_id, filter.owner_id), eq(pipeline_oidc_trust.deleted, false)))
			.orderBy(desc(pipeline_oidc_trust.created_at), asc(pipeline_oidc_trust.id));
		return ok(rows);
	} catch (e) {
		return err({ kind: "db_error", message: `failed to list pipeline_oidc_trust: ${String(e)}` });
	}
};

export type GetTrustPolicyInput = {
	id: string;
	owner_id: string;
};

/**
 * Read a trust policy by id, scoped to its owner. Returns `not_found`
 * for unknown ids, soft-deleted rows, and rows belonging to a
 * different owner (no info leak via 403 vs 404 distinction at the
 * service layer; the route boundary maps both to 404).
 */
export const get_trust_policy = async (
	db: Database,
	input: GetTrustPolicyInput,
): Promise<Result<PipelineOidcTrust, ServiceError>> => {
	try {
		const rows = await db
			.select()
			.from(pipeline_oidc_trust)
			.where(
				and(
					eq(pipeline_oidc_trust.id, input.id),
					eq(pipeline_oidc_trust.owner_id, input.owner_id),
					eq(pipeline_oidc_trust.deleted, false),
				),
			);
		const row = rows.at(0);
		if (!row) return err({ kind: "not_found", resource: "pipeline_oidc_trust", id: input.id });
		return ok(row);
	} catch (e) {
		return err({
			kind: "db_error",
			message: `failed to read pipeline_oidc_trust ${input.id}: ${String(e)}`,
		});
	}
};

export type CreateTrustPolicyInput = UpsertPipelineOidcTrust;

/**
 * Insert a trust policy. The validation schema lives in `@devpad/schema`
 * (`upsert_pipeline_oidc_trust`) — defaults applied here mirror plan
 * §I.5: `repo_pattern: "*"`, `allowed_actions: ["artifacts:upload",
 * "runs:start"]`, `provider: "github"`, `session_ttl_seconds: 900`.
 */
export const create_trust_policy = async (
	db: Database,
	input: CreateTrustPolicyInput,
): Promise<Result<PipelineOidcTrust, ServiceError>> => {
	const parsed = upsert_pipeline_oidc_trust.safeParse(input);
	if (!parsed.success) {
		const errors: Record<string, string[]> = {};
		for (const issue of parsed.error.issues) {
			const key = issue.path.join(".") || "_";
			(errors[key] ??= []).push(issue.message);
		}
		return err({ kind: "validation", errors, message: "invalid trust policy input" });
	}
	const data = parsed.data;
	try {
		const now = new Date().toISOString();
		const insert_values = {
			owner_id: data.owner_id,
			provider: data.provider ?? "github",
			github_owner: data.github_owner,
			repo_pattern: data.repo_pattern ?? DEFAULT_REPO_PATTERN,
			allowed_refs: data.allowed_refs ?? [],
			allowed_environments: data.allowed_environments ?? [],
			expected_audience: data.expected_audience,
			allowed_actions: data.allowed_actions ?? [...DEFAULT_ALLOWED_ACTIONS],
			session_ttl_seconds: data.session_ttl_seconds ?? DEFAULT_SESSION_TTL_SECONDS,
			last_used_at: data.last_used_at ?? null,
			created_at: now,
			updated_at: now,
			created_by: "api",
			modified_by: "api",
			protected: false,
			deleted: false,
		};
		const inserted = await db
			.insert(pipeline_oidc_trust)
			.values(insert_values as never)
			.returning();
		const row = inserted.at(0);
		if (!row)
			return err({
				kind: "store_error",
				operation: "insert_pipeline_oidc_trust",
				message: "insert returned no row",
			});
		return ok(row);
	} catch (e) {
		return err({ kind: "db_error", message: `failed to create pipeline_oidc_trust: ${String(e)}` });
	}
};

export type UpdateTrustPolicyInput = {
	id: string;
	owner_id: string;
} & Partial<Omit<UpsertPipelineOidcTrust, "id" | "owner_id">>;

/**
 * Partially patch a trust policy. Only fields present on `input` are
 * touched. Owner scoping enforced — a user cannot patch another user's
 * policy (`not_found` on mismatch). Validation runs on the merged
 * record so partial inputs still pass the Zod schema.
 */
export const update_trust_policy = async (
	db: Database,
	input: UpdateTrustPolicyInput,
): Promise<Result<PipelineOidcTrust, ServiceError>> => {
	const existing = await get_trust_policy(db, { id: input.id, owner_id: input.owner_id });
	if (!existing.ok) return existing;

	const merged = {
		id: existing.value.id,
		owner_id: existing.value.owner_id,
		provider: input.provider ?? existing.value.provider,
		github_owner: input.github_owner ?? existing.value.github_owner,
		repo_pattern: input.repo_pattern ?? existing.value.repo_pattern,
		allowed_refs: input.allowed_refs ?? existing.value.allowed_refs,
		allowed_environments: input.allowed_environments ?? existing.value.allowed_environments,
		expected_audience: input.expected_audience ?? existing.value.expected_audience,
		allowed_actions: input.allowed_actions ?? existing.value.allowed_actions,
		session_ttl_seconds: input.session_ttl_seconds ?? existing.value.session_ttl_seconds,
		last_used_at: input.last_used_at ?? existing.value.last_used_at,
	};

	const parsed = upsert_pipeline_oidc_trust.safeParse(merged);
	if (!parsed.success) {
		const errors: Record<string, string[]> = {};
		for (const issue of parsed.error.issues) {
			const key = issue.path.join(".") || "_";
			(errors[key] ??= []).push(issue.message);
		}
		return err({ kind: "validation", errors, message: "invalid trust policy patch" });
	}

	try {
		const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), modified_by: "api" };
		if (input.provider !== undefined) patch.provider = input.provider;
		if (input.github_owner !== undefined) patch.github_owner = input.github_owner;
		if (input.repo_pattern !== undefined) patch.repo_pattern = input.repo_pattern;
		if (input.allowed_refs !== undefined) patch.allowed_refs = input.allowed_refs;
		if (input.allowed_environments !== undefined) patch.allowed_environments = input.allowed_environments;
		if (input.expected_audience !== undefined) patch.expected_audience = input.expected_audience;
		if (input.allowed_actions !== undefined) patch.allowed_actions = input.allowed_actions;
		if (input.session_ttl_seconds !== undefined) patch.session_ttl_seconds = input.session_ttl_seconds;
		if (input.last_used_at !== undefined) patch.last_used_at = input.last_used_at;

		const updated = await db
			.update(pipeline_oidc_trust)
			.set(patch as never)
			.where(and(eq(pipeline_oidc_trust.id, input.id), eq(pipeline_oidc_trust.owner_id, input.owner_id)))
			.returning();
		const row = updated.at(0);
		if (!row)
			return err({
				kind: "store_error",
				operation: "update_pipeline_oidc_trust",
				message: "update returned no row",
			});
		return ok(row);
	} catch (e) {
		return err({
			kind: "db_error",
			message: `failed to update pipeline_oidc_trust ${input.id}: ${String(e)}`,
		});
	}
};

export type DeleteTrustPolicyInput = {
	id: string;
	owner_id: string;
};

/**
 * Soft-delete a trust policy. Matches the `entity()` convention used
 * across the schema — the row is preserved for audit, just flagged
 * `deleted = true`. List + get queries filter it out automatically.
 */
export const delete_trust_policy = async (
	db: Database,
	input: DeleteTrustPolicyInput,
): Promise<Result<void, ServiceError>> => {
	const existing = await get_trust_policy(db, input);
	if (!existing.ok) return existing;
	try {
		const patch = { deleted: true, updated_at: new Date().toISOString(), modified_by: "api" };
		await db
			.update(pipeline_oidc_trust)
			.set(patch as never)
			.where(and(eq(pipeline_oidc_trust.id, input.id), eq(pipeline_oidc_trust.owner_id, input.owner_id)));
		return ok(undefined);
	} catch (e) {
		return err({
			kind: "db_error",
			message: `failed to delete pipeline_oidc_trust ${input.id}: ${String(e)}`,
		});
	}
};

export type TouchTrustPolicyInput = {
	id: string;
};

/**
 * Bump `last_used_at` after a successful exchange. Called from 15.A's
 * `/auth/github-oidc` route — owner is not required because the
 * matcher has already proven ownership via the OIDC claims chain.
 * Idempotent: failure here is non-fatal; the route should log + swallow.
 */
export const touch_trust_policy_last_used = async (
	db: Database,
	input: TouchTrustPolicyInput,
): Promise<Result<void, ServiceError>> => {
	try {
		const now = new Date().toISOString();
		const patch = { last_used_at: now, updated_at: now };
		await db
			.update(pipeline_oidc_trust)
			.set(patch)
			.where(eq(pipeline_oidc_trust.id, input.id));
		return ok(undefined);
	} catch (e) {
		return err({
			kind: "db_error",
			message: `failed to touch pipeline_oidc_trust ${input.id}: ${String(e)}`,
		});
	}
};
