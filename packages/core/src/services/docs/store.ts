/**
 * @module core/services/docs/store
 *
 * v2.4 (task A4.1) — the doc store: corpus-backed content, `document` as a
 * thin DB-side index (project/task/kind/status + `head_version` cache).
 * Corpus is the source of truth per locked decision 3 (the annotated doc IS
 * the artifact); `document.head_version` is a cache a reconciliation pass
 * could always rebuild from `list_versions` — never a second source of
 * truth for content itself.
 *
 * Every document gets its OWN dedicated corpus store id (`docStoreId`),
 * mirroring `packages/core/src/services/blog/corpus.ts`'s per-post pattern —
 * `store.list()` for one document never sees another document's versions,
 * so "list version history" and "walk lineage" are the same operation.
 */

import type { PushDocRequest } from "@devpad/schema";
import { document, type DocumentStatus } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import type { Document } from "@devpad/schema/types";
import {
	type Backend,
	create_store,
	define_store,
	err,
	format_error,
	json_codec,
	ok,
	type CorpusError as LibCorpusError,
	type Result,
	type SnapshotMeta,
} from "@f0rbit/corpus";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { errors, type ServiceError } from "../errors.js";
import { type EmitEventInput, write_with_event } from "../graph/outbox.js";
import { sanitize_html } from "./sanitize.js";

export const DocContentSchema = z.object({
	title: z.string().min(1),
	html: z.string(),
});
export type DocContent = z.infer<typeof DocContentSchema>;

export const docStoreId = (document_id: string): string => `docs/${document_id}`;

const base_definition = define_store("devpad-docs", json_codec(DocContentSchema));

const store_for = (backend: Backend, document_id: string) =>
	create_store(backend, { ...base_definition, id: docStoreId(document_id) });

export type DocCorpusError =
	| { kind: "not_found"; document_id: string; version?: string }
	| { kind: "invalid_content"; message: string }
	| { kind: "io_error"; message: string };

function map_corpus_error(e: LibCorpusError, document_id: string): DocCorpusError {
	if (e.kind === "not_found") return { kind: "not_found", document_id, version: e.version };
	if (e.kind === "decode_error" || e.kind === "validation_error") {
		return { kind: "invalid_content", message: e.cause.message };
	}
	if (e.kind === "storage_error") return { kind: "io_error", message: e.cause.message };
	return { kind: "io_error", message: `Unknown corpus error: ${e.kind}` };
}

export type DocVersionInfo = { version: string; parent: string | null; created_at: Date; tags: string[] };

function to_version_info(meta: SnapshotMeta): DocVersionInfo {
	return {
		version: meta.version,
		parent: meta.parents[0]?.version ?? null,
		created_at: meta.created_at,
		tags: meta.tags ?? [],
	};
}

/** Pushes a new corpus version for a document's dedicated store, stamping `parents` for lineage. */
export async function push_version(
	backend: Backend,
	document_id: string,
	content: DocContent,
	parent_version: string | null,
): Promise<Result<{ version: string }, DocCorpusError>> {
	const store = store_for(backend, document_id);
	const opts = parent_version ? { parents: [{ store_id: docStoreId(document_id), version: parent_version }] } : {};
	const result = await store.put(content, opts);
	if (!result.ok) return err(map_corpus_error(result.error, document_id));
	return ok({ version: result.value.version });
}

/** Pulls a specific version, or the latest if `version` is omitted. */
export async function get_version(
	backend: Backend,
	document_id: string,
	version?: string,
): Promise<Result<DocContent, DocCorpusError>> {
	const store = store_for(backend, document_id);
	const result = version ? await store.get(version) : await store.get_latest();
	if (!result.ok) return err(map_corpus_error(result.error, document_id));
	return ok(result.value.data);
}

/**
 * The full version history for one document, newest first — the lineage
 * walk (task A4.1's "version param walking lineage"). Walks `parents`
 * pointers rather than sorting by `created_at`: two pushes in the same
 * millisecond (routine in tests, possible in production) tie on timestamp,
 * but never on lineage — `generate_version()`'s own `.N` disambiguator is an
 * implementation detail of the corpus lib, not something this module should
 * lean on for ordering.
 */
export async function list_versions(
	backend: Backend,
	document_id: string,
): Promise<Result<DocVersionInfo[], DocCorpusError>> {
	const store = store_for(backend, document_id);
	const metas: SnapshotMeta[] = [];
	try {
		for await (const meta of store.list()) metas.push(meta);
	} catch (e) {
		return err({ kind: "io_error", message: format_error(e) });
	}
	if (metas.length === 0) return ok([]);

	const by_version = new Map(metas.map((m) => [m.version, m]));
	const referenced_as_parent = new Set<string>();
	for (const m of metas) {
		if (m.parents.length > 0) referenced_as_parent.add(m.parents[0].version);
	}
	// The common case is exactly one head (linear history); if more than one
	// somehow exists (a bug or a racing double-push), walk the newest chain
	// first — still deterministic, never drops a version.
	const heads = metas.filter((m) => !referenced_as_parent.has(m.version));
	heads.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());

	const ordered: DocVersionInfo[] = [];
	const visited = new Set<string>();
	for (const head of heads) {
		let cursor: SnapshotMeta | undefined = head;
		while (cursor && !visited.has(cursor.version)) {
			visited.add(cursor.version);
			ordered.push(to_version_info(cursor));
			const parent_version = cursor.parents[0]?.version;
			cursor = parent_version ? by_version.get(parent_version) : undefined;
		}
	}
	// Defensive: a meta unreachable from any head (shouldn't happen) still surfaces.
	for (const meta of metas) {
		if (!visited.has(meta.version)) ordered.push(to_version_info(meta));
	}
	return ok(ordered);
}

/**
 * Zero-copy approval transition (task A4.3) — mutates the EXISTING version's
 * metadata to add `tag`, via the backend's metadata client directly. No new
 * content write, no new version: promoting a doc never touches `data`.
 */
export async function promote(
	backend: Backend,
	document_id: string,
	version: string,
	tag: string,
): Promise<Result<void, DocCorpusError>> {
	const store_id = docStoreId(document_id);
	const meta_result = await backend.metadata.get(store_id, version);
	if (!meta_result.ok) return err(map_corpus_error(meta_result.error, document_id));
	const tags = new Set(meta_result.value.tags ?? []);
	tags.add(tag);
	const put_result = await backend.metadata.put({ ...meta_result.value, tags: [...tags] });
	if (!put_result.ok) return err(map_corpus_error(put_result.error, document_id));
	return ok(undefined);
}

// ---------------------------------------------------------------------------
// DB-side index (`document` table)
// ---------------------------------------------------------------------------

export async function get_document(db: Database, id: string): Promise<Result<Document, ServiceError>> {
	const rows = await db
		.select()
		.from(document)
		.where(and(eq(document.id, id), eq(document.deleted, false)));
	if (rows.length === 0) return errors.notFound("document", id);
	return ok(rows[0]);
}

export async function list_documents(
	db: Database,
	filters: { project_id?: string; task_id?: string },
): Promise<Result<Document[], ServiceError>> {
	const conditions = [eq(document.deleted, false)];
	if (filters.project_id) conditions.push(eq(document.project_id, filters.project_id));
	if (filters.task_id) conditions.push(eq(document.task_id, filters.task_id));
	const rows = await db
		.select()
		.from(document)
		.where(and(...conditions));
	return ok(rows);
}

export type PushDocError = ServiceError | DocCorpusError;

/**
 * Sanitizes the incoming HTML, pushes it as a new corpus version (stamping
 * `parents` from the current head for lineage), then updates (or creates)
 * the `document` index row and emits the `doc.pushed` outbox event.
 *
 * Corpus is pushed FIRST (it's the source of truth); the DB-side index
 * update + event emission happen together via `write_with_event`. A crash
 * between the two leaves an extra, unreferenced corpus version — harmless
 * and recoverable (a future reconciliation pass can always resync
 * `head_version` from `list_versions`), never a lost or corrupted document.
 */
export async function push_document(
	db: Database,
	backend: Backend,
	input: PushDocRequest,
	auth_channel: "user" | "api",
): Promise<Result<Document, PushDocError>> {
	const clean_html = sanitize_html(input.html);

	if (input.document_id) {
		const existing = await get_document(db, input.document_id);
		if (!existing.ok) return existing;
		if (existing.value.project_id !== input.project_id) {
			return errors.badRequest(`Document ${input.document_id} belongs to a different project`);
		}

		const pushed = await push_version(
			backend,
			existing.value.id,
			{ title: input.title, html: clean_html },
			existing.value.head_version,
		);
		if (!pushed.ok) return pushed;

		return write_with_event(
			db,
			async (): Promise<Result<Document, ServiceError>> => {
				const rows = await db
					.update(document)
					.set({
						title: input.title,
						head_version: pushed.value.version,
						modified_by: auth_channel,
						updated_at: new Date().toISOString(),
					})
					.where(eq(document.id, existing.value.id))
					.returning();
				if (rows.length === 0) return errors.notFound("document", existing.value.id);
				return ok(rows[0]);
			},
			(row): EmitEventInput => ({
				kind: "doc.pushed",
				subject_id: row.id,
				project_id: row.project_id,
				actor: auth_channel,
				payload: { kind: "doc.pushed", document_id: row.id, version: pushed.value.version },
			}),
		);
	}

	const inserted = await db
		.insert(document)
		.values({
			project_id: input.project_id,
			task_id: input.task_id ?? null,
			kind: input.kind,
			title: input.title,
			status: "draft" satisfies DocumentStatus,
			created_by: auth_channel,
			modified_by: auth_channel,
		})
		.returning();
	const new_document = inserted[0];

	const pushed = await push_version(backend, new_document.id, { title: input.title, html: clean_html }, null);
	if (!pushed.ok) return pushed;

	return write_with_event(
		db,
		async (): Promise<Result<Document, ServiceError>> => {
			const rows = await db
				.update(document)
				.set({ head_version: pushed.value.version, updated_at: new Date().toISOString() })
				.where(eq(document.id, new_document.id))
				.returning();
			if (rows.length === 0) return errors.notFound("document", new_document.id);
			return ok(rows[0]);
		},
		(row): EmitEventInput => ({
			kind: "doc.pushed",
			subject_id: row.id,
			project_id: row.project_id,
			actor: auth_channel,
			payload: { kind: "doc.pushed", document_id: row.id, version: pushed.value.version },
		}),
	);
}
