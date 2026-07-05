import type { PipelineGrant, UpsertPipelineGrant } from "@devpad/schema";
import { pipeline_grant } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { err, match, ok, type Result } from "@f0rbit/corpus";
import { eq } from "drizzle-orm";
import type { ServiceError } from "../errors.js";
import { evaluate_grant_check, is_auto_approvable } from "./grants-domain.js";

export type { GrantVerdict } from "./grants-domain.js";
export { evaluate_grant_check, is_auto_approvable, is_grant_match } from "./grants-domain.js";

export const AUTO_APPROVE_USER = "system:auto-approve";

/**
 * List all grants for a package.
 */
export async function list_grants(db: Database, package_id: string): Promise<Result<PipelineGrant[], ServiceError>> {
	try {
		const grants = await db.select().from(pipeline_grant).where(eq(pipeline_grant.package_id, package_id));

		return ok(grants);
	} catch (e) {
		return err({
			kind: "db_error",
			message: `Failed to list grants for package ${package_id}: ${String(e)}`,
		});
	}
}

/**
 * Check if a scope is granted at a stage for a package.
 * Returns true if granted, false otherwise (via Result error propagation).
 */
export async function check_grant(
	db: Database,
	package_id: string,
	stage_name: string,
	scope: string,
): Promise<Result<boolean, ServiceError>> {
	return match(
		await list_grants(db, package_id),
		(grants) => {
			const verdict = evaluate_grant_check(grants, scope, stage_name);
			return ok(verdict.granted);
		},
		(error) => err(error) as Result<boolean, ServiceError>,
	);
}

/**
 * Request a new grant. Auto-approves if policy says so, otherwise leaves pending.
 * TODO(phase-2): emit devpad approval item for manual approvals.
 */
export async function request_grant(
	db: Database,
	package_id: string,
	stage_name: string,
	scope: string,
): Promise<Result<PipelineGrant, ServiceError>> {
	try {
		const now = new Date().toISOString();
		const auto_approvable = is_auto_approvable(scope, stage_name);

		const grant_data: UpsertPipelineGrant = {
			package_id,
			stage_name,
			scope,
			granted_at: auto_approvable ? now : null,
			granted_by: auto_approvable ? AUTO_APPROVE_USER : null,
		};

		const inserted = await db
			.insert(pipeline_grant)
			.values({
				...grant_data,
				id: `pipeline-grant_${crypto.randomUUID()}`,
				created_at: now,
				updated_at: now,
				created_by: "api",
				modified_by: "api",
				protected: false,
				deleted: false,
			})
			.returning();

		if (!inserted[0]) {
			return err({
				kind: "store_error",
				operation: "insert_grant",
				message: "Failed to insert grant",
			});
		}

		return ok(inserted[0]);
	} catch (e) {
		return err({
			kind: "db_error",
			message: `Failed to request grant for scope "${scope}" at stage "${stage_name}": ${String(e)}`,
		});
	}
}

/**
 * Approve an existing grant.
 */
export async function approve_grant(
	db: Database,
	grant_id: string,
	user_id: string,
): Promise<Result<PipelineGrant, ServiceError>> {
	try {
		const now = new Date().toISOString();

		const updated = await db
			.update(pipeline_grant)
			.set({
				granted_at: now,
				granted_by: user_id,
				updated_at: now,
				modified_by: "user",
			})
			.where(eq(pipeline_grant.id, grant_id))
			.returning();

		if (!updated[0]) {
			return err({
				kind: "not_found",
				resource: "grant",
				id: grant_id,
			});
		}

		return ok(updated[0]);
	} catch (e) {
		return err({
			kind: "db_error",
			message: `Failed to approve grant ${grant_id}: ${String(e)}`,
		});
	}
}

/**
 * Deny an existing grant.
 */
export async function deny_grant(
	db: Database,
	grant_id: string,
	user_id: string,
	reason?: string,
): Promise<Result<void, ServiceError>> {
	try {
		const now = new Date().toISOString();

		const updated = await db
			.update(pipeline_grant)
			.set({
				granted_at: null,
				granted_by: null,
				updated_at: now,
				modified_by: "user",
			})
			.where(eq(pipeline_grant.id, grant_id))
			.returning();

		if (!updated[0]) {
			return err({
				kind: "not_found",
				resource: "grant",
				id: grant_id,
			});
		}

		// `pipeline_grant` has no denied_by/denied_reason columns yet (a
		// schema change, out of scope here) -- log the audit context so the
		// denying user + reason aren't silently dropped until the schema
		// catches up to record them on the row itself.
		console.info(`pipeline grant ${grant_id} denied by ${user_id}${reason ? `: ${reason}` : ""}`);

		return ok(undefined);
	} catch (e) {
		return err({
			kind: "db_error",
			message: `Failed to deny grant ${grant_id}: ${String(e)}`,
		});
	}
}
