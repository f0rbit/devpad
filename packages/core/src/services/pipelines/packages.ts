/**
 * @module core/services/pipelines/packages
 *
 * Read + write surface for {@link PipelinePackage} rows. The orchestrator
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
 * - `create_package` — insert a new row. Guards against duplicate id and
 *   invalid `project_id` FK (we don't rely on D1 to enforce — bun:sqlite
 *   has FKs off by default, matching D1's behaviour for these paths).
 * - `update_package` — partial update by id. `not_found` if absent.
 * - `delete_package` — refuses to delete a package that still has
 *   `pipeline_run` rows (returns conflict with the run count). Operators
 *   must clean up runs explicitly before deleting.
 */

import type { PipelinePackage } from "@devpad/schema";
import { pipeline_package, pipeline_run, project } from "@devpad/schema/database/schema";
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
export const list_packages = async (
	db: Database,
	filter: ListPackagesFilter = {},
): Promise<Result<PipelinePackage[], ServiceError>> => {
	try {
		const conditions = [];
		if (filter.project_id !== undefined) conditions.push(eq(pipeline_package.project_id, filter.project_id));

		const base = db.select().from(pipeline_package);
		const where =
			conditions.length === 0
				? base
				: conditions.length === 1
					? base.where(conditions[0])
					: base.where(and(...conditions));
		const rows = await where;
		return ok(rows);
	} catch (e) {
		return err({ kind: "db_error", message: `failed to list pipeline_package: ${String(e)}` });
	}
};

/**
 * Read a single package by id. `not_found` propagates as a typed error
 * so the route boundary can map to 404.
 */
export const get_package = async (db: Database, package_id: string): Promise<Result<PipelinePackage, ServiceError>> => {
	try {
		const rows = await db.select().from(pipeline_package).where(eq(pipeline_package.id, package_id));
		const row = rows.at(0);
		if (!row) return err({ kind: "not_found", resource: "pipeline_package", id: package_id });
		return ok(row);
	} catch (e) {
		return err({
			kind: "db_error",
			message: `failed to read pipeline_package ${package_id}: ${String(e)}`,
		});
	}
};

export type CreatePackageInput = {
	id: string;
	name: string;
	owner_id: string;
	repo_url?: string | null;
	project_id?: string | null;
	default_template_ref?: string | null;
};

/**
 * Insert a new pipeline package row. The id is supplied (canonical
 * convention: id == name). Returns conflict on duplicate; not_found on
 * a project_id that doesn't exist in the project table.
 */
export const create_package = async (
	db: Database,
	input: CreatePackageInput,
): Promise<Result<PipelinePackage, ServiceError>> => {
	try {
		const existing = await db.select().from(pipeline_package).where(eq(pipeline_package.id, input.id));
		if (existing[0]) {
			const conflict_error = {
				kind: "conflict",
				resource: "pipeline_package",
				id: input.id,
				message: `pipeline_package "${input.id}" already exists`,
			};
			return err(conflict_error as ServiceError);
		}

		if (input.project_id !== undefined && input.project_id !== null) {
			const project_row = await db.select().from(project).where(eq(project.id, input.project_id));
			if (!project_row[0]) {
				return err({ kind: "not_found", resource: "project", id: input.project_id });
			}
		}

		const now = new Date().toISOString();
		const insert_values = {
			id: input.id,
			owner_id: input.owner_id,
			name: input.name,
			repo_url: input.repo_url ?? null,
			project_id: input.project_id ?? null,
			default_template_ref: input.default_template_ref ?? null,
			script_name_overrides: null,
			created_at: now,
			updated_at: now,
			created_by: "api",
			modified_by: "api",
			protected: false,
			deleted: false,
		};
		const inserted = await db
			.insert(pipeline_package)
			.values(insert_values as never)
			.returning();

		const row = inserted.at(0);
		if (!row)
			return err({
				kind: "store_error",
				operation: "insert_pipeline_package",
				message: "insert returned no row",
			});
		return ok(row);
	} catch (e) {
		return err({
			kind: "db_error",
			message: `failed to create pipeline_package "${input.id}": ${String(e)}`,
		});
	}
};

export type UpdatePackageInput = Partial<{
	repo_url: string | null;
	project_id: string | null;
	default_template_ref: string | null;
	script_name_overrides: Record<string, string> | null;
}>;

/**
 * Partially update a package. Only the fields present on `input` are
 * touched; missing keys preserve existing values. Returns `not_found`
 * when the id doesn't exist.
 */
export const update_package = async (
	db: Database,
	package_id: string,
	input: UpdatePackageInput,
): Promise<Result<PipelinePackage, ServiceError>> => {
	try {
		const existing = await db.select().from(pipeline_package).where(eq(pipeline_package.id, package_id));
		if (!existing[0]) return err({ kind: "not_found", resource: "pipeline_package", id: package_id });

		if (input.project_id !== undefined && input.project_id !== null) {
			const project_row = await db.select().from(project).where(eq(project.id, input.project_id));
			if (!project_row[0]) return err({ kind: "not_found", resource: "project", id: input.project_id });
		}

		const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), modified_by: "api" };
		if ("repo_url" in input) patch.repo_url = input.repo_url;
		if ("project_id" in input) patch.project_id = input.project_id;
		if ("default_template_ref" in input) patch.default_template_ref = input.default_template_ref;
		if ("script_name_overrides" in input) patch.script_name_overrides = input.script_name_overrides;

		const updated = await db
			.update(pipeline_package)
			.set(patch as never)
			.where(eq(pipeline_package.id, package_id))
			.returning();
		const row = updated.at(0);
		if (!row)
			return err({
				kind: "store_error",
				operation: "update_pipeline_package",
				message: "update returned no row",
			});
		return ok(row);
	} catch (e) {
		return err({
			kind: "db_error",
			message: `failed to update pipeline_package "${package_id}": ${String(e)}`,
		});
	}
};

/**
 * Delete a package. Refuses if pipeline_run rows still reference it —
 * returns conflict with the run count so the operator can clean up runs
 * first. We never cascade-delete runs.
 */
export const delete_package = async (db: Database, package_id: string): Promise<Result<void, ServiceError>> => {
	try {
		const existing = await db.select().from(pipeline_package).where(eq(pipeline_package.id, package_id));
		if (!existing[0]) return err({ kind: "not_found", resource: "pipeline_package", id: package_id });

		const runs = await db
			.select({ id: pipeline_run.id })
			.from(pipeline_run)
			.where(eq(pipeline_run.package_id, package_id));
		if (runs.length > 0) {
			const conflict_error = {
				kind: "conflict",
				resource: "pipeline_package",
				id: package_id,
				reason: "active_runs",
				count: runs.length,
				message: `pipeline_package "${package_id}" still has ${String(runs.length)} run(s); delete them first`,
			};
			return err(conflict_error as ServiceError);
		}

		await db.delete(pipeline_package).where(eq(pipeline_package.id, package_id));
		return ok(undefined);
	} catch (e) {
		return err({
			kind: "db_error",
			message: `failed to delete pipeline_package "${package_id}": ${String(e)}`,
		});
	}
};
