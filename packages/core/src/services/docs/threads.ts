/**
 * @module core/services/docs/threads
 *
 * v2.4 (task A4.2) — the annotation engine's mutation + reconciliation
 * layer: create/reply/resolve/toggle-blocking, the `push_document_annotated`
 * entrypoint every doc push should go through, and the rebuildable
 * `annotation_thread` index.
 */

import type { CreateThreadRequest, PushDocRequest, ThreadMarker } from "@devpad/schema/validation";
import { annotation_thread } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import type { AnnotationThread, Document } from "@devpad/schema/types";
import { type Backend, ok, type Result } from "@f0rbit/corpus";
import { and, eq, ne } from "drizzle-orm";
import { errors, type ServiceError } from "../errors.js";
import { emit_event } from "../graph/outbox.js";
import { resolve_anchor } from "./anchor.js";
import {
	begin_comment,
	embed_marker,
	parse_markers,
	replace_marker,
	replace_orphan_marker,
	strip_markers,
} from "./markers.js";
import { sanitize_html, sanitize_text } from "./sanitize.js";
import { type DocCorpusError, type PushDocError, get_document, get_version, push_document_raw } from "./store.js";

export type ThreadMutationError = ServiceError | DocCorpusError;
export type ActorInfo = { author: string; channel: "user" | "api" };

export type ReconcileResult = { html: string; threads: ThreadMarker[]; orphaned: ThreadMarker[] };

/**
 * Re-anchors (or orphans) every marker found in `incoming_html` against its
 * own OWN clean (sanitized, marker-free) content, then sanitizes and
 * re-embeds. A no-op superset of a plain sanitize for a marker-free doc, so
 * every push — annotated or not — can safely go through this.
 *
 * Deliberately re-validates EVERY marker (not just unpaired ones) via
 * `resolve_anchor`, per architecture-decisions' "verifies-then-falls-back,
 * always validated against the stored quote" — a still-paired marker whose
 * bracketed content silently drifted from its stored quote is caught here
 * too, not just genuinely unpaired ones.
 */
export function reconcile(incoming_html: string): ReconcileResult {
	const { threads: paired, orphans } = parse_markers(incoming_html);
	const { stripped } = strip_markers(incoming_html);
	const clean = sanitize_html(stripped);

	const candidates: ThreadMarker[] = [
		...paired.map((t) => t.marker),
		...orphans.flatMap((o) => (o.marker ? [o.marker] : [])),
	];

	const resolved: { marker: ThreadMarker; range: { start: number; end: number } }[] = [];
	const orphaned: ThreadMarker[] = [];
	for (const marker of candidates) {
		const resolution = resolve_anchor(clean, marker.anchor);
		if (resolution.status === "ok") {
			const healed = marker.status === "orphaned" ? { ...marker, status: "open" as const } : marker;
			resolved.push({ marker: healed, range: resolution });
		} else {
			orphaned.push({ ...marker, status: "orphaned" });
		}
	}

	let html = clean;
	for (const { marker, range } of resolved) html = embed_marker(html, marker, range);
	for (const marker of orphaned) html = `${html}\n${begin_comment(marker)}`;

	return { html, threads: resolved.map((r) => r.marker), orphaned };
}

/**
 * The entrypoint every doc push should use (superseding `store.push_document`
 * at the route layer): reconciles existing markers, then pushes + refreshes
 * the thread index. `store.push_document` remains for direct/internal
 * callers that don't need annotation awareness (kept exactly as task A4.1
 * tested it).
 */
export async function push_document_annotated(
	db: Database,
	backend: Backend,
	input: PushDocRequest,
	auth_channel: "user" | "api",
): Promise<Result<Document, PushDocError>> {
	const reconciled = reconcile(input.html);
	const result = await push_document_raw(db, backend, { ...input, html: reconciled.html }, auth_channel);
	if (!result.ok) return result;
	const rebuild = await rebuild_thread_index(db, backend, result.value.id);
	if (!rebuild.ok) return rebuild;
	return result;
}

async function pull_head(
	db: Database,
	backend: Backend,
	document_id: string,
): Promise<Result<{ doc: Document; html: string; title: string }, ThreadMutationError>> {
	const doc = await get_document(db, document_id);
	if (!doc.ok) return doc;
	if (!doc.value.head_version) return errors.badRequest(`Document ${document_id} has no content to annotate yet`);
	const content = await get_version(backend, document_id, doc.value.head_version);
	if (!content.ok) return content;
	return ok({ doc: doc.value, html: content.value.html, title: content.value.title });
}

function push_payload(head: { doc: Document; title: string }, html: string): PushDocRequest {
	return {
		document_id: head.doc.id,
		project_id: head.doc.project_id,
		task_id: head.doc.task_id,
		kind: head.doc.kind,
		title: head.title,
		html,
	};
}

// `CreateThreadRequest.blocking`'s zod `.default(false)` makes `z.infer`
// produce a non-optional `boolean` — accurate for a caller that actually
// went through `create_thread_request.parse()` (the HTTP route), but a lie
// for any other caller (tests, future internal callers) passing a plain
// object that may genuinely omit it. Widening it back to optional here
// keeps the honest-fallback (`blocking ?? false`) below from being flagged
// as dead code by the linter while still matching runtime reality.
export type CreateThreadInput = Omit<CreateThreadRequest, "blocking"> & { blocking?: boolean };

/** Embeds a fresh marker for a brand-new thread and pushes the resulting version. */
export async function create_thread(
	db: Database,
	backend: Backend,
	document_id: string,
	input: CreateThreadInput,
	actor: ActorInfo,
): Promise<Result<Document, ThreadMutationError>> {
	const head = await pull_head(db, backend, document_id);
	if (!head.ok) return head;

	const marker: ThreadMarker = {
		id: `thread_${crypto.randomUUID()}`,
		anchor: { quote: input.quote, prefix: input.prefix, suffix: input.suffix, start: input.start, end: input.end },
		status: "open",
		blocking: input.blocking ?? false,
		entries: [
			{ author: actor.author, channel: actor.channel, body: sanitize_text(input.body), at: new Date().toISOString() },
		],
	};

	const embedded = embed_marker(head.value.html, marker, { start: input.start, end: input.end });
	const pushed = await push_document_raw(db, backend, push_payload(head.value, embedded), actor.channel);
	if (!pushed.ok) return pushed;

	const event = await emit_event(db, {
		kind: "thread.opened",
		subject_id: pushed.value.id,
		project_id: pushed.value.project_id,
		actor: actor.channel,
		payload: { kind: "thread.opened", document_id: pushed.value.id, thread_id: marker.id },
	});
	if (!event.ok) return event;
	const rebuild = await rebuild_thread_index(db, backend, document_id);
	if (!rebuild.ok) return rebuild;
	return pushed;
}

/**
 * Mutates a thread's marker in place (reply/resolve/toggle-blocking share
 * this) — tries a currently-PAIRED thread first, then falls back to an
 * ORPHANED one (B3 fast-follow #7: "visible must not mean dead-ended" — an
 * orphan gets the same reply/resolve/toggle-blocking actions a live thread
 * does, via `replace_orphan_marker`). `not_found` if `thread_id` is neither.
 */
async function mutate_thread(
	db: Database,
	backend: Backend,
	document_id: string,
	thread_id: string,
	actor: ActorInfo,
	mutate: (marker: ThreadMarker) => ThreadMarker,
): Promise<Result<Document, ThreadMutationError>> {
	const head = await pull_head(db, backend, document_id);
	if (!head.ok) return head;

	const { threads, orphans } = parse_markers(head.value.html);
	const paired = threads.find((t) => t.marker.id === thread_id);
	if (paired) {
		const replaced = replace_marker(head.value.html, thread_id, mutate(paired.marker));
		if (!replaced) return errors.notFound("thread", thread_id);
		return push_document_raw(db, backend, push_payload(head.value, replaced), actor.channel);
	}

	const orphaned = orphans.find((o) => o.marker?.id === thread_id);
	if (orphaned?.marker) {
		const replaced = replace_orphan_marker(head.value.html, thread_id, mutate(orphaned.marker));
		if (!replaced) return errors.notFound("thread", thread_id);
		return push_document_raw(db, backend, push_payload(head.value, replaced), actor.channel);
	}

	return errors.notFound("thread", thread_id);
}

export async function reply_thread(
	db: Database,
	backend: Backend,
	document_id: string,
	thread_id: string,
	body: string,
	actor: ActorInfo,
): Promise<Result<Document, ThreadMutationError>> {
	const result = await mutate_thread(db, backend, document_id, thread_id, actor, (marker) => ({
		...marker,
		entries: [
			...marker.entries,
			{ author: actor.author, channel: actor.channel, body: sanitize_text(body), at: new Date().toISOString() },
		],
	}));
	if (!result.ok) return result;
	const rebuild = await rebuild_thread_index(db, backend, document_id);
	if (!rebuild.ok) return rebuild;
	return result;
}

export async function resolve_thread(
	db: Database,
	backend: Backend,
	document_id: string,
	thread_id: string,
	actor: ActorInfo,
): Promise<Result<Document, ThreadMutationError>> {
	const result = await mutate_thread(db, backend, document_id, thread_id, actor, (marker) => ({
		...marker,
		status: "resolved",
	}));
	if (!result.ok) return result;
	const event = await emit_event(db, {
		kind: "thread.resolved",
		subject_id: result.value.id,
		project_id: result.value.project_id,
		actor: actor.channel,
		payload: { kind: "thread.resolved", document_id: result.value.id, thread_id },
	});
	if (!event.ok) return event;
	const rebuild = await rebuild_thread_index(db, backend, document_id);
	if (!rebuild.ok) return rebuild;
	return result;
}

export async function toggle_blocking(
	db: Database,
	backend: Backend,
	document_id: string,
	thread_id: string,
	blocking: boolean,
	actor: ActorInfo,
): Promise<Result<Document, ThreadMutationError>> {
	const result = await mutate_thread(db, backend, document_id, thread_id, actor, (marker) => ({ ...marker, blocking }));
	if (!result.ok) return result;
	const rebuild = await rebuild_thread_index(db, backend, document_id);
	if (!rebuild.ok) return rebuild;
	return result;
}

/**
 * Rebuilds the `annotation_thread` index for one document entirely from its
 * head doc — never an incremental patch. Provably rebuildable (adversary
 * checklist): dropping the table's rows for a document and calling this
 * reproduces the exact same state.
 */
export async function rebuild_thread_index(
	db: Database,
	backend: Backend,
	document_id: string,
): Promise<Result<void, ThreadMutationError>> {
	const doc = await get_document(db, document_id);
	if (!doc.ok) return doc;

	await db.delete(annotation_thread).where(eq(annotation_thread.document_id, document_id));
	if (!doc.value.head_version) return ok(undefined);

	const content = await get_version(backend, document_id, doc.value.head_version);
	if (!content.ok) return content;

	const { threads, orphans } = parse_markers(content.value.html);
	const rows = [
		...threads.map((t) => ({
			document_id,
			thread_id: t.marker.id,
			status: t.marker.status,
			blocking: t.marker.blocking,
		})),
		...orphans.flatMap((o) =>
			o.marker
				? [{ document_id, thread_id: o.marker.id, status: "orphaned" as const, blocking: o.marker.blocking }]
				: [],
		),
	];
	if (rows.length > 0) await db.insert(annotation_thread).values(rows);
	return ok(undefined);
}

/** Unresolved = anything not `resolved` — open, addressed, or orphaned all still need human attention. */
export async function list_unresolved(
	db: Database,
	filters: { document_id?: string } = {},
): Promise<Result<AnnotationThread[], ServiceError>> {
	const conditions = [ne(annotation_thread.status, "resolved")];
	if (filters.document_id) conditions.push(eq(annotation_thread.document_id, filters.document_id));
	const rows = await db
		.select()
		.from(annotation_thread)
		.where(and(...conditions));
	return ok(rows);
}
