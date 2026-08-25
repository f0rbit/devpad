/**
 * @module core/services/docs/reconcile
 *
 * v2.4 (B3, CSS-exfil fix) — the one-time repair path for docs pushed BEFORE
 * `sanitize.ts` learned to scrub `<style>` blocks. Scoped to one owner's
 * projects (mirrors `graph/fold-verify.ts`'s `verify_fold` — a per-account
 * diagnostic/repair, not a system-wide dump) and run via
 * `devpad admin reconcile-docs-css`.
 *
 * CSS-only, never a full `sanitize_html` re-run: a stored doc's live
 * annotation markers are HTML comments, and `sanitize_html` strips ALL
 * comments unconditionally (by design — see `sanitize.ts`). Re-sanitizing
 * markers away here would silently destroy every open thread on every doc it
 * touches, which is a strictly worse outcome than the CSS vector it's fixing.
 */

import { document, project } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import type { Document } from "@devpad/schema/types";
import { type Backend, ok, type Result } from "@f0rbit/corpus";
import { and, eq } from "drizzle-orm";
import type { ServiceError } from "../errors.js";
import { sanitize_style_blocks } from "./sanitize.js";
import { type DocCorpusError, get_version, push_document_raw } from "./store.js";

export type ReconcileCssReport = { scanned: number; reconciled: string[] };

async function owned_documents(db: Database, owner_id: string): Promise<Document[]> {
	const rows = await db
		.select({ document })
		.from(document)
		.innerJoin(project, eq(document.project_id, project.id))
		.where(and(eq(project.owner_id, owner_id), eq(document.deleted, false)));
	return rows.map((r) => r.document);
}

/** Re-scrubs CSS exfil vectors out of every already-stored doc's head version, owner-scoped. A doc with unchanged output after the scrub is left untouched (no spurious version bump). */
export async function reconcile_docs_css(
	db: Database,
	backend: Backend,
	owner_id: string,
): Promise<Result<ReconcileCssReport, ServiceError | DocCorpusError>> {
	const docs = await owned_documents(db, owner_id);
	const reconciled: string[] = [];

	for (const doc of docs) {
		if (!doc.head_version) continue;
		const content = await get_version(backend, doc.id, doc.head_version);
		if (!content.ok) return content;

		const fixed_html = sanitize_style_blocks(content.value.html);
		if (fixed_html === content.value.html) continue;

		const pushed = await push_document_raw(
			db,
			backend,
			{
				document_id: doc.id,
				project_id: doc.project_id,
				task_id: doc.task_id,
				kind: doc.kind,
				title: content.value.title,
				html: fixed_html,
			},
			"api",
		);
		if (!pushed.ok) return pushed;
		reconciled.push(doc.id);
	}

	return ok({ scanned: docs.length, reconciled });
}
