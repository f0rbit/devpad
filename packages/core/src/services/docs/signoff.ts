/**
 * @module core/services/docs/signoff
 *
 * v2.4 (task A4.3) — the generalized human-approval ledger. A checkpoint
 * request creates a `kind:"approval"` task node (human-only completable,
 * enforced in `graph/completion.ts` + `graph/apply.ts`) with explicit
 * `blocks` edges to the caller-named downstream tasks (architecture-decisions:
 * "explicit, not inferred"). `decide()` is the only place a signoff's
 * `decision` is ever written.
 */

import type { DecideCheckpointRequest, RequestCheckpointRequest } from "@devpad/schema/validation";
import { annotation_thread, signoff, task } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import type { Document, Signoff, SignoffCheckpoint, SignoffSubjectKind } from "@devpad/schema/types";
import { type Backend, ok, type Result } from "@f0rbit/corpus";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { errors, type ServiceError } from "../errors.js";
import { SqlCompletionEngine } from "../graph/completion.js";
import { add_link, get_task_row, type GraphError } from "../graph/graph.js";
import { emit_event, type EmitEventInput, write_with_event } from "../graph/outbox.js";
import { classify_diff, type InterfaceDiffClass } from "./interface-report.js";
import { sanitize_text } from "./sanitize.js";
import { type DocCorpusError, get_document, get_version, list_versions, promote, push_document_raw } from "./store.js";

export type SignoffError = ServiceError | GraphError | DocCorpusError;

export async function request_checkpoint(
	db: Database,
	input: RequestCheckpointRequest,
	ctx: { owner_id: string; auth_channel: "user" | "api" },
): Promise<Result<{ signoff: Signoff; task_id: string }, SignoffError>> {
	const title = `Approve ${input.checkpoint}: ${input.subject_kind}/${input.subject_id}`;

	const task_result = await write_with_event(
		db,
		async () => {
			const rows = await db
				.insert(task)
				.values({
					owner_id: ctx.owner_id,
					project_id: input.project_id,
					title,
					kind: "approval",
					completion_policy: "manual",
					created_by: ctx.auth_channel,
					modified_by: ctx.auth_channel,
				})
				.returning();
			return ok(rows[0]);
		},
		(row): EmitEventInput => ({
			kind: "task.created",
			subject_id: row.id,
			project_id: row.project_id,
			actor: ctx.auth_channel,
			payload: { kind: "task.created", title: row.title },
		}),
	);
	if (!task_result.ok) return task_result;
	const approval_task = task_result.value;

	for (const blocked_id of input.blocks) {
		const link_result = await add_link(db, { src_id: approval_task.id, dst_id: blocked_id, kind: "blocks" });
		if (!link_result.ok) return link_result;
	}

	const signoff_rows = await db
		.insert(signoff)
		.values({
			subject_kind: input.subject_kind,
			subject_id: input.subject_id,
			checkpoint: input.checkpoint,
			task_id: approval_task.id,
			created_by: ctx.auth_channel,
			modified_by: ctx.auth_channel,
		})
		.returning();
	const signoff_row = signoff_rows[0];

	const event = await emit_event(db, {
		kind: "signoff.requested",
		subject_id: approval_task.id,
		project_id: approval_task.project_id,
		actor: ctx.auth_channel,
		payload: {
			kind: "signoff.requested",
			subject_kind: input.subject_kind,
			subject_id: input.subject_id,
			checkpoint: input.checkpoint,
		},
	});
	if (!event.ok) return event;

	return ok({ signoff: signoff_row, task_id: approval_task.id });
}

export async function get_signoff(db: Database, id: string): Promise<Result<Signoff, ServiceError>> {
	const rows = await db.select().from(signoff).where(eq(signoff.id, id));
	if (rows.length === 0) return errors.notFound("signoff", id);
	return ok(rows[0]);
}

/** The most recent decided (approved or auto) signoff for a subject+checkpoint — the interface-report CLI's "is there an approved base" check. */
export async function latest_decided_signoff(
	db: Database,
	subject_kind: SignoffSubjectKind,
	subject_id: string,
	checkpoint: SignoffCheckpoint,
): Promise<Result<Signoff | null, ServiceError>> {
	const rows = await db
		.select()
		.from(signoff)
		.where(
			and(
				eq(signoff.subject_kind, subject_kind),
				eq(signoff.subject_id, subject_id),
				eq(signoff.checkpoint, checkpoint),
				ne(signoff.decision, "changes_requested"),
			),
		)
		// `decided_at` is millisecond-resolution wall-clock time (`new Date().toISOString()`);
		// a manual decision followed immediately by an auto-approve (same push) can tie on it,
		// so `rowid` (monotonic insertion order, SQLite's implicit tiebreaker) breaks ties —
		// same lesson as `list_versions` walking `parents` instead of sorting by `created_at`.
		.orderBy(desc(signoff.decided_at), desc(sql`rowid`));
	const decided = rows.filter((r) => r.decision === "approved" || r.decision === "auto");
	return ok(decided[0] ?? null);
}

/**
 * v2.4 (B3) — the checkpoint card's/verdict bar's "is there something to
 * decide right now" lookup: the most recent UNDECIDED signoff for a
 * subject+checkpoint, or `null` if none has been requested yet. Distinct
 * from `latest_decided_signoff` (which only ever returns a DECIDED one) —
 * a subject can have at most one meaningfully "current" pending signoff at
 * a time in practice, but this deliberately picks the latest by insertion
 * order (same `rowid` tiebreak as `latest_decided_signoff`) rather than
 * assuming uniqueness.
 */
export async function pending_signoff_for(
	db: Database,
	subject_kind: SignoffSubjectKind,
	subject_id: string,
	checkpoint: SignoffCheckpoint,
): Promise<Result<Signoff | null, ServiceError>> {
	const rows = await db
		.select()
		.from(signoff)
		.where(
			and(
				eq(signoff.subject_kind, subject_kind),
				eq(signoff.subject_id, subject_id),
				eq(signoff.checkpoint, checkpoint),
				sql`${signoff.decision} IS NULL`,
			),
		)
		.orderBy(desc(sql`rowid`));
	return ok(rows[0] ?? null);
}

/**
 * The Buf-style fast path (task A4.4): a diff classified `additive` against
 * an already-approved base skips human review entirely — no approval task
 * node is ever created, only an audit row recording the auto-decision. This
 * is the one place a signoff can be `decision:"auto"` — never through
 * `decide_checkpoint`, which is human-only by construction.
 */
export async function auto_approve(
	db: Database,
	input: { subject_kind: SignoffSubjectKind; subject_id: string; checkpoint: SignoffCheckpoint; content_hash: string },
): Promise<Result<Signoff, ServiceError>> {
	const rows = await db
		.insert(signoff)
		.values({
			subject_kind: input.subject_kind,
			subject_id: input.subject_id,
			checkpoint: input.checkpoint,
			decision: "auto",
			decided_at: new Date().toISOString(),
			content_hash: input.content_hash,
			created_by: "api",
			modified_by: "api",
		})
		.returning();
	const created = rows[0];

	const event = await emit_event(db, {
		kind: "signoff.decided",
		subject_id: input.subject_id,
		project_id: null,
		actor: "api",
		payload: {
			kind: "signoff.decided",
			subject_kind: input.subject_kind,
			subject_id: input.subject_id,
			checkpoint: input.checkpoint,
			decision: "auto",
		},
	});
	if (!event.ok) return event;

	return ok(created);
}

/** Open blocking annotation threads on a doc_version subject's head — vetoes approval (architecture-decisions). Not used for other subject kinds. */
async function open_blocking_threads(db: Database, document_id: string): Promise<{ thread_id: string }[]> {
	return db
		.select({ thread_id: annotation_thread.thread_id })
		.from(annotation_thread)
		.where(
			and(
				eq(annotation_thread.document_id, document_id),
				eq(annotation_thread.blocking, true),
				ne(annotation_thread.status, "resolved"),
			),
		);
}

/**
 * Human-only (rejects api-channel up front — even recording
 * `changes_requested` on someone else's checkpoint is a human judgment
 * call). `approved` on a `doc_version` subject: vetoed by any open blocking
 * annotation thread, otherwise zero-copy `promote()`s the head version and
 * stamps its content_hash, then completes the approval task THROUGH the
 * engine (READY recomputes, events fire) — never a direct `progress` write.
 */
export async function decide_checkpoint(
	db: Database,
	backend: Backend,
	signoff_id: string,
	input: DecideCheckpointRequest,
	ctx: { user_id: string; auth_channel: "user" | "api" },
): Promise<Result<Signoff, SignoffError>> {
	if (ctx.auth_channel !== "user")
		return errors.approvalChannel(signoff_id, "Only a human may decide a signoff checkpoint");

	const existing = await get_signoff(db, signoff_id);
	if (!existing.ok) return existing;
	if (existing.value.decision) return errors.conflict("signoff", `Signoff ${signoff_id} was already decided`);
	const record = existing.value;

	if (record.subject_kind === "doc_version" && input.decision === "approved") {
		const blocking = await open_blocking_threads(db, record.subject_id);
		if (blocking.length > 0) {
			return errors.conflict(
				"signoff",
				`Approval blocked by open blocking thread(s): ${blocking.map((b) => b.thread_id).join(", ")}`,
			);
		}
	}

	let content_hash: string | null = null;
	if (record.subject_kind === "doc_version" && input.decision === "approved") {
		const doc_result = await get_document(db, record.subject_id);
		if (!doc_result.ok) return doc_result;
		if (!doc_result.value.head_version)
			return errors.badRequest(`Document ${record.subject_id} has no content to approve`);
		const promoted = await promote(backend, record.subject_id, doc_result.value.head_version, "approved");
		if (!promoted.ok) return promoted;
		content_hash = promoted.value.content_hash;
	}

	if (input.decision === "approved" && record.task_id) {
		const task_row = await get_task_row(db, record.task_id);
		if (!task_row) return errors.notFound("task", record.task_id);
		const engine = new SqlCompletionEngine(db);
		const complete_result = await engine.complete(record.task_id, "user", task_row.rev);
		if (!complete_result.ok) return complete_result;
	}

	const updated_rows = await db
		.update(signoff)
		.set({
			decision: input.decision,
			decided_by: ctx.user_id,
			decided_at: new Date().toISOString(),
			reason: input.reason ?? null,
			content_hash,
			modified_by: "user",
			updated_at: new Date().toISOString(),
		})
		.where(eq(signoff.id, signoff_id))
		.returning();
	const updated = updated_rows[0];

	const project_id = record.task_id ? ((await get_task_row(db, record.task_id))?.project_id ?? null) : null;
	const event = await emit_event(db, {
		kind: "signoff.decided",
		subject_id: updated.id,
		project_id,
		actor: "user",
		payload: {
			kind: "signoff.decided",
			subject_kind: record.subject_kind,
			subject_id: record.subject_id,
			checkpoint: record.checkpoint,
			decision: input.decision,
		},
	});
	if (!event.ok) return event;

	return ok(updated);
}

export type PushInterfaceReportResult = {
	document: Document;
	classification: InterfaceDiffClass;
	signoff: Signoff | null;
};

/**
 * Interface report v1 push (task A4.4). Pushes via `push_document_raw` (not
 * `push_document`) — the normalized declaration text isn't real markup, so
 * running it through the full HTML sanitizer (which parses tags/attributes)
 * would mangle meaningful `<`/`>` generic syntax. It's still untrusted
 * input reaching corpus storage though (adversary checklist: sanitize on
 * EVERY write path, regardless of caller) — `sanitize_text` HTML-escapes it
 * as plain text instead, which a future plain-text/`<pre>` render decodes
 * back to the original characters while a literal `<script>` stays inert.
 * The CLI (`interface-commands.ts`) applies the SAME escape before hashing
 * locally, so `check`'s hash comparison stays honest against what the
 * server actually stored.
 *
 * Classification is computed SERVER-SIDE against the previously
 * approved/auto base (never trusting a client-supplied "this is additive"
 * claim) — additive fast-paths to `auto_approve`; anything else (including
 * no prior base at all) leaves `signoff: null` for the caller to
 * `request_checkpoint` explicitly.
 */
export async function push_interface_report(
	db: Database,
	backend: Backend,
	input: { document_id?: string; project_id: string; task_id?: string | null; title: string; normalized: string },
	ctx: { auth_channel: "user" | "api" },
): Promise<Result<PushInterfaceReportResult, SignoffError>> {
	const escaped = sanitize_text(input.normalized);

	let previous_content: string | null = null;
	if (input.document_id) {
		const latest = await latest_decided_signoff(db, "doc_version", input.document_id, "types");
		if (!latest.ok) return latest;
		if (latest.value) {
			const versions = await list_versions(backend, input.document_id);
			if (!versions.ok) return versions;
			const match = versions.value.find((v) => v.content_hash === latest.value?.content_hash);
			if (match) {
				const content = await get_version(backend, input.document_id, match.version);
				if (content.ok) previous_content = content.value.html;
			}
		}
	}

	const pushed = await push_document_raw(
		db,
		backend,
		{
			document_id: input.document_id,
			project_id: input.project_id,
			task_id: input.task_id ?? null,
			kind: "interface",
			title: input.title,
			html: escaped,
		},
		ctx.auth_channel,
	);
	if (!pushed.ok) return pushed;

	if (previous_content === null) {
		return ok({ document: pushed.value, classification: "unchanged", signoff: null });
	}

	const classification = classify_diff(previous_content, escaped);
	if (classification !== "additive") {
		return ok({ document: pushed.value, classification, signoff: null });
	}

	const versions_after = await list_versions(backend, pushed.value.id);
	if (!versions_after.ok) return versions_after;
	const head_meta = versions_after.value.find((v) => v.version === pushed.value.head_version);
	if (!head_meta) return errors.dbError("Pushed interface version missing from corpus listing");

	const auto = await auto_approve(db, {
		subject_kind: "doc_version",
		subject_id: pushed.value.id,
		checkpoint: "types",
		content_hash: head_meta.content_hash,
	});
	if (!auto.ok) return auto;

	return ok({ document: pushed.value, classification: "additive", signoff: auto.value });
}
