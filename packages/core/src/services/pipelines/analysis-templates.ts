/**
 * @module core/services/pipelines/analysis-templates
 *
 * Read + write surface for {@link PipelineAnalysisTemplate} rows. Mirrors
 * `packages.ts` structurally — every read+write path filters by
 * `owner_id` (single-tenant today, but the column is in place so multi-user
 * ACLs slot in later).
 *
 * Surface:
 *
 * - `list_analysis_templates` — list templates for an owner.
 * - `get_analysis_template` — read one template by id, scoped to its owner.
 * - `create_analysis_template` — insert a new row. `threshold_dsl` is
 *   parsed via `parse_threshold_dsl` before insert; parse failures surface
 *   as `validation_error` with `field: "threshold_dsl"`.
 * - `update_analysis_template` — partial update by id. Re-parses
 *   `threshold_dsl` when supplied.
 * - `delete_analysis_template` — hard-delete by id. Intentionally does
 *   NOT check `pipeline_run.resolved_gates` — runs snapshot their gate
 *   template at resolve-time, so deleting the template afterwards is
 *   safe and does not orphan in-flight runs.
 */

import type { PipelineAnalysisTemplate } from "@devpad/schema";
import { pipeline_analysis_template } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { err, ok, type Result } from "@f0rbit/corpus";
import { and, eq } from "drizzle-orm";
import type { ServiceError } from "../errors.js";
import { parse_threshold_dsl } from "./gates/analysis-domain.js";

export type ListAnalysisTemplatesFilter = {
	owner_id: string;
};

/**
 * List analysis templates for an owner. Returns an empty array when no
 * rows match — never a `not_found` error.
 */
export const list_analysis_templates = async (db: Database, filter: ListAnalysisTemplatesFilter): Promise<Result<PipelineAnalysisTemplate[], ServiceError>> => {
	try {
		const rows = await db.select().from(pipeline_analysis_template).where(eq(pipeline_analysis_template.owner_id, filter.owner_id));
		return ok(rows);
	} catch (e) {
		return err({ kind: "db_error", message: `failed to list pipeline_analysis_template: ${String(e)}` } as ServiceError);
	}
};

export type GetAnalysisTemplateInput = {
	id: string;
	owner_id: string;
};

/**
 * Read a single template by id, scoped to its owner. `not_found`
 * propagates as a typed error so the route boundary can map to 404.
 */
export const get_analysis_template = async (db: Database, input: GetAnalysisTemplateInput): Promise<Result<PipelineAnalysisTemplate, ServiceError>> => {
	try {
		const rows = await db
			.select()
			.from(pipeline_analysis_template)
			.where(and(eq(pipeline_analysis_template.id, input.id), eq(pipeline_analysis_template.owner_id, input.owner_id)));
		const row = rows[0];
		if (!row) return err({ kind: "not_found", resource: "pipeline_analysis_template", id: input.id } as ServiceError);
		return ok(row);
	} catch (e) {
		return err({ kind: "db_error", message: `failed to read pipeline_analysis_template ${input.id}: ${String(e)}` } as ServiceError);
	}
};

export type CreateAnalysisTemplateInput = {
	id?: string;
	owner_id: string;
	name: string;
	threshold_dsl: string;
	query_dsl?: unknown;
	window_ms?: number;
};

/**
 * Insert a new analysis template row. The `threshold_dsl` is validated by
 * `parse_threshold_dsl` before insert — parse failures surface as
 * `validation_error` with `field: "threshold_dsl"`, never a 500.
 */
export const create_analysis_template = async (db: Database, input: CreateAnalysisTemplateInput): Promise<Result<PipelineAnalysisTemplate, ServiceError>> => {
	const parsed = parse_threshold_dsl(input.threshold_dsl);
	if (!parsed.ok) {
		return err({ kind: "validation_error", field: "threshold_dsl", message: parsed.error.message } as ServiceError);
	}

	try {
		const id = input.id ?? `pipeline-analysis-template_${crypto.randomUUID()}`;

		const existing = await db
			.select()
			.from(pipeline_analysis_template)
			.where(and(eq(pipeline_analysis_template.id, id), eq(pipeline_analysis_template.owner_id, input.owner_id)));
		if (existing[0]) {
			return err({ kind: "conflict", resource: "pipeline_analysis_template", id, message: `pipeline_analysis_template "${id}" already exists` } as ServiceError);
		}

		const now = new Date().toISOString();
		const inserted = await db
			.insert(pipeline_analysis_template)
			.values({
				id,
				owner_id: input.owner_id,
				name: input.name,
				query_dsl: (input.query_dsl ?? {}) as never,
				threshold_dsl: input.threshold_dsl as never,
				window_ms: input.window_ms ?? 600_000,
				created_at: now,
				updated_at: now,
				created_by: "api",
				modified_by: "api",
				protected: false,
				deleted: false,
			} as never)
			.returning();

		const row = inserted[0];
		if (!row) return err({ kind: "store_error", operation: "insert_pipeline_analysis_template", message: "insert returned no row" } as ServiceError);
		return ok(row);
	} catch (e) {
		return err({ kind: "db_error", message: `failed to create pipeline_analysis_template: ${String(e)}` } as ServiceError);
	}
};

export type UpdateAnalysisTemplateInput = {
	id: string;
	owner_id: string;
} & Partial<{
	name: string;
	threshold_dsl: string;
	query_dsl: unknown;
	window_ms: number;
}>;

/**
 * Partially update a template. Only the fields present on `input` are
 * touched; missing keys preserve existing values. Returns `not_found`
 * when the id doesn't exist (or is owned by someone else). Re-parses
 * `threshold_dsl` when supplied — parse failure surfaces as
 * `validation_error`.
 */
export const update_analysis_template = async (db: Database, input: UpdateAnalysisTemplateInput): Promise<Result<PipelineAnalysisTemplate, ServiceError>> => {
	if (input.threshold_dsl !== undefined) {
		const parsed = parse_threshold_dsl(input.threshold_dsl);
		if (!parsed.ok) {
			return err({ kind: "validation_error", field: "threshold_dsl", message: parsed.error.message } as ServiceError);
		}
	}

	try {
		const existing = await db
			.select()
			.from(pipeline_analysis_template)
			.where(and(eq(pipeline_analysis_template.id, input.id), eq(pipeline_analysis_template.owner_id, input.owner_id)));
		if (!existing[0]) return err({ kind: "not_found", resource: "pipeline_analysis_template", id: input.id } as ServiceError);

		const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), modified_by: "api" };
		if ("name" in input && input.name !== undefined) patch.name = input.name;
		if ("threshold_dsl" in input && input.threshold_dsl !== undefined) patch.threshold_dsl = input.threshold_dsl;
		if ("query_dsl" in input) patch.query_dsl = input.query_dsl;
		if ("window_ms" in input && input.window_ms !== undefined) patch.window_ms = input.window_ms;

		const updated = await db
			.update(pipeline_analysis_template)
			.set(patch as never)
			.where(and(eq(pipeline_analysis_template.id, input.id), eq(pipeline_analysis_template.owner_id, input.owner_id)))
			.returning();
		const row = updated[0];
		if (!row) return err({ kind: "store_error", operation: "update_pipeline_analysis_template", message: "update returned no row" } as ServiceError);
		return ok(row);
	} catch (e) {
		return err({ kind: "db_error", message: `failed to update pipeline_analysis_template "${input.id}": ${String(e)}` } as ServiceError);
	}
};

export type DeleteAnalysisTemplateInput = {
	id: string;
	owner_id: string;
};

/**
 * Delete a template. Intentionally does NOT check `pipeline_run.resolved_gates`
 * — runs snapshot their gate template at resolve-time, so deleting the
 * template afterwards is safe and does not orphan in-flight runs.
 */
export const delete_analysis_template = async (db: Database, input: DeleteAnalysisTemplateInput): Promise<Result<void, ServiceError>> => {
	try {
		const existing = await db
			.select()
			.from(pipeline_analysis_template)
			.where(and(eq(pipeline_analysis_template.id, input.id), eq(pipeline_analysis_template.owner_id, input.owner_id)));
		if (!existing[0]) return err({ kind: "not_found", resource: "pipeline_analysis_template", id: input.id } as ServiceError);

		await db.delete(pipeline_analysis_template).where(and(eq(pipeline_analysis_template.id, input.id), eq(pipeline_analysis_template.owner_id, input.owner_id)));
		return ok(undefined);
	} catch (e) {
		return err({ kind: "db_error", message: `failed to delete pipeline_analysis_template "${input.id}": ${String(e)}` } as ServiceError);
	}
};
