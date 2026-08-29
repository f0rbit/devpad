/**
 * @module core/services/docs/reviews
 *
 * v2.4 (task A4.6) — the reviews-pending aggregate: one typed shape across
 * every source of "a human needs to look at this" — pending signoff
 * checkpoints, open blocking annotation threads, pending pipeline manual
 * gates, and pending scanner diffs. Powers the agent's "what's blocking me
 * on a human" AND the future "Waiting on you" UI from one source. Scoped to
 * the requesting user's own tasks/projects — never cross-user.
 */

import type { ReviewItem } from "@devpad/schema/validation";
import {
	annotation_thread,
	document,
	pipeline_approval,
	pipeline_package,
	pipeline_run,
	project,
	signoff,
	task,
	todo_updates,
} from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { ok, type Result } from "@f0rbit/corpus";
import { and, eq, isNull, ne } from "drizzle-orm";
import type { ServiceError } from "../errors.js";

async function pending_signoffs(db: Database, owner_id: string): Promise<ReviewItem[]> {
	const rows = await db
		.select({
			id: signoff.id,
			subject_kind: signoff.subject_kind,
			subject_id: signoff.subject_id,
			checkpoint: signoff.checkpoint,
			created_at: signoff.created_at,
			project_id: task.project_id,
			owner_id: task.owner_id,
		})
		.from(signoff)
		.innerJoin(task, eq(signoff.task_id, task.id))
		.where(and(isNull(signoff.decision), eq(task.owner_id, owner_id)));

	return rows.map((row) => ({
		kind: "signoff",
		subject_id: row.id,
		title: `${row.checkpoint} checkpoint — ${row.subject_kind}/${row.subject_id}`,
		project_id: row.project_id,
		created_at: row.created_at,
		// v2.4 (B3.3) — a real UI page, not a placeholder: `doc_version`
		// signoffs deep-link into the docs tab with the document pre-selected
		// (DocViewer's verdict bar decides it); `stage` signoffs deep-link
		// into the outline zoomed on the gated task (the SDLC stepper's
		// checkpoint card decides it there). `pipeline_gate` has its own
		// existing pipeline-run UI, not this doc-review surface.
		path: !row.project_id
			? "/todo"
			: row.subject_kind === "doc_version"
				? `/project/${row.project_id}/docs?doc=${row.subject_id}`
				: `/project/${row.project_id}/work?node=${row.subject_id}`,
	}));
}

async function pending_blocking_annotations(db: Database, owner_id: string): Promise<ReviewItem[]> {
	const rows = await db
		.select({
			thread_id: annotation_thread.thread_id,
			document_id: annotation_thread.document_id,
			created_at: annotation_thread.created_at,
			project_id: document.project_id,
			doc_title: document.title,
			owner_id: project.owner_id,
		})
		.from(annotation_thread)
		.innerJoin(document, eq(annotation_thread.document_id, document.id))
		.innerJoin(project, eq(document.project_id, project.id))
		.where(
			and(
				eq(annotation_thread.blocking, true),
				ne(annotation_thread.status, "resolved"),
				eq(project.owner_id, owner_id),
			),
		);

	return rows.map((row) => ({
		kind: "annotation",
		subject_id: row.thread_id,
		title: `Blocking thread on "${row.doc_title}"`,
		project_id: row.project_id,
		created_at: row.created_at,
		path: `/project/${row.project_id}/docs?doc=${row.document_id}`,
	}));
}

async function pending_pipeline_gates(db: Database, owner_id: string): Promise<ReviewItem[]> {
	const rows = await db
		.select({
			id: pipeline_approval.id,
			run_id: pipeline_approval.run_id,
			stage_name: pipeline_approval.stage_name,
			created_at: pipeline_approval.created_at,
			project_id: pipeline_package.project_id,
			package_name: pipeline_package.name,
			owner_id: pipeline_package.owner_id,
		})
		.from(pipeline_approval)
		.innerJoin(pipeline_run, eq(pipeline_approval.run_id, pipeline_run.id))
		.innerJoin(pipeline_package, eq(pipeline_run.package_id, pipeline_package.id))
		.where(and(isNull(pipeline_approval.decision), eq(pipeline_package.owner_id, owner_id)));

	return rows.map((row) => ({
		kind: "pipeline_gate",
		subject_id: row.id,
		title: `${row.package_name} — ${row.stage_name}`,
		project_id: row.project_id,
		created_at: row.created_at,
		path: row.project_id ? `/project/${row.project_id}/pipeline?run=${row.run_id}` : `/pipelines/runs/${row.run_id}`,
	}));
}

async function pending_scan_diffs(db: Database, owner_id: string): Promise<ReviewItem[]> {
	const rows = await db
		.select({
			id: todo_updates.id,
			created_at: todo_updates.created_at,
			project_id: todo_updates.project_id,
			project_name: project.name,
			owner_id: project.owner_id,
		})
		.from(todo_updates)
		.innerJoin(project, eq(todo_updates.project_id, project.id))
		.where(and(eq(todo_updates.status, "PENDING"), eq(project.owner_id, owner_id)));

	return rows.map((row) => ({
		kind: "scan_diff",
		subject_id: String(row.id),
		title: `Scan diff — ${row.project_name}`,
		project_id: row.project_id,
		created_at: row.created_at,
		path: `/project/${row.project_id}?scan=${String(row.id)}`,
	}));
}

/** Empty state is `ok([])`, never an error — every source query is scoped to `owner_id` up front, so "nothing pending" is the honest common case. */
export async function pending_reviews(db: Database, owner_id: string): Promise<Result<ReviewItem[], ServiceError>> {
	const [signoffs, annotations, gates, scans] = await Promise.all([
		pending_signoffs(db, owner_id),
		pending_blocking_annotations(db, owner_id),
		pending_pipeline_gates(db, owner_id),
		pending_scan_diffs(db, owner_id),
	]);

	const items = [...signoffs, ...annotations, ...gates, ...scans];
	items.sort((a, b) => a.created_at.localeCompare(b.created_at));
	return ok(items);
}
