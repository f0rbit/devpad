/**
 * @module core/services/pipelines/packages
 *
 * Read-side service for {@link PipelinePackage} rows. The orchestrator
 * UI scopes packages by linked devpad project — a nullable FK
 * (`pipeline_package.project_id`) added in migration 0012. Existing
 * packages have `project_id = null` until they're linked.
 *
 * Surface:
 *
 * - `list_packages` — list all packages, optionally filtered by
 *   `project_id`.
 * - `get_package` — read one package by id, returns `not_found` when
 *   missing.
 *
 * Writes go through the existing `upsert_pipeline_package` flow elsewhere
 * — this module is read-only.
 */

import type { PipelinePackage } from "@devpad/schema";
import { pipeline_package } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { err, ok, type Result } from "@f0rbit/corpus";
import { and, eq } from "drizzle-orm";
import type { ServiceError } from "../errors.js";

export type ListPackagesFilter = {
	project_id?: string;
};

/**
 * List pipeline packages, optionally filtered by linked devpad project.
 * Returns an empty array when no rows match — never a `not_found` error.
 */
export const list_packages = async (db: Database, filter: ListPackagesFilter = {}): Promise<Result<PipelinePackage[], ServiceError>> => {
	try {
		const conditions = [];
		if (filter.project_id !== undefined) conditions.push(eq(pipeline_package.project_id, filter.project_id));

		const base = db.select().from(pipeline_package);
		const where = conditions.length === 0 ? base : conditions.length === 1 ? base.where(conditions[0]) : base.where(and(...conditions));
		const rows = await where;
		return ok(rows);
	} catch (e) {
		return err({ kind: "db_error", message: `failed to list pipeline_package: ${String(e)}` } as ServiceError);
	}
};

/**
 * Read a single package by id. `not_found` propagates as a typed error
 * so the route boundary can map to 404.
 */
export const get_package = async (db: Database, package_id: string): Promise<Result<PipelinePackage, ServiceError>> => {
	try {
		const rows = await db.select().from(pipeline_package).where(eq(pipeline_package.id, package_id));
		const row = rows[0];
		if (!row) return err({ kind: "not_found", resource: "pipeline_package", id: package_id } as ServiceError);
		return ok(row);
	} catch (e) {
		return err({ kind: "db_error", message: `failed to read pipeline_package ${package_id}: ${String(e)}` } as ServiceError);
	}
};
