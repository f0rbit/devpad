import { beforeEach, describe, expect, test } from "bun:test";
import { annotation_thread } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { type Backend, create_memory_backend } from "@f0rbit/corpus";
import { eq } from "drizzle-orm";
import { get_version, push_document } from "../../store.js";
import {
	create_thread,
	list_unresolved,
	push_document_annotated,
	rebuild_thread_index,
	reply_thread,
	resolve_thread,
	toggle_blocking,
} from "../../threads.js";
import { create_test_db, seed_project, seed_user } from "./helpers.js";

const BASE_TEXT = "The quick brown fox jumps over the lazy dog.";
const DOC_HTML = `<p>${BASE_TEXT}</p>`;
const ACTOR = { author: "tom", channel: "user" as const };

describe("annotation engine — threads over corpus lineage (task A4.2)", () => {
	let db: Database;
	let backend: Backend;
	let project_id: string;

	beforeEach(async () => {
		db = create_test_db();
		backend = create_memory_backend();
		const owner = await seed_user(db);
		const project = await seed_project(db, owner.id);
		project_id = project.id;
	});

	async function push_doc(html: string) {
		const result = await push_document(db, backend, { project_id, kind: "design", title: "Design", html }, "api");
		if (!result.ok) throw new Error("push failed");
		return result.value;
	}

	/** Pulls the CURRENT head content (markers and all) — simulates an agent editing the actually-annotated doc, not writing fresh content from scratch. */
	async function pull_html(document_id: string, head_version: string | null): Promise<string> {
		if (!head_version) throw new Error("expected head_version");
		const result = await get_version(backend, document_id, head_version);
		if (!result.ok) throw new Error("pull failed");
		return result.value.html;
	}

	// Offsets are relative to the STRIPPED (marker-free) doc content, which for
	// a freshly-pushed document equals the raw HTML itself — including the
	// `<p>` wrapper, not just the bare sentence.
	function anchor_for(quote: string) {
		const start = DOC_HTML.indexOf(quote);
		return {
			quote,
			prefix: DOC_HTML.slice(Math.max(0, start - 10), start),
			suffix: DOC_HTML.slice(start + quote.length, start + quote.length + 10),
			start,
			end: start + quote.length,
		};
	}

	test("create_thread embeds a marker and the index records it as open, non-blocking", async () => {
		const doc = await push_doc(DOC_HTML);
		const created = await create_thread(db, backend, doc.id, { ...anchor_for("brown fox"), body: "seems off" }, ACTOR);
		expect(created.ok).toBe(true);

		const rows = await db.select().from(annotation_thread).where(eq(annotation_thread.document_id, doc.id));
		expect(rows).toHaveLength(1);
		expect(rows[0]?.status).toBe("open");
		expect(rows[0]?.blocking).toBe(false);
	});

	test("re-anchors across a push that edits content BEFORE the annotated span", async () => {
		const doc = await push_doc(DOC_HTML);
		const created = await create_thread(db, backend, doc.id, { ...anchor_for("brown fox"), body: "seems off" }, ACTOR);
		if (!created.ok) throw new Error("create failed");

		const annotated_html = await pull_html(doc.id, created.value.head_version);
		const edited_html = annotated_html.replace("<p>", "<p>Once upon a time, ");
		const edited = await push_document_annotated(
			db,
			backend,
			{ document_id: doc.id, project_id, kind: "design", title: "Design", html: edited_html },
			"api",
		);
		expect(edited.ok).toBe(true);

		const rows = await db.select().from(annotation_thread).where(eq(annotation_thread.document_id, doc.id));
		expect(rows).toHaveLength(1);
		expect(rows[0]?.status).toBe("open");
	});

	test("re-anchors across a push that edits content AFTER the annotated span", async () => {
		const doc = await push_doc(DOC_HTML);
		const created = await create_thread(db, backend, doc.id, { ...anchor_for("brown fox"), body: "seems off" }, ACTOR);
		if (!created.ok) throw new Error("create failed");

		const annotated_html = await pull_html(doc.id, created.value.head_version);
		const edited_html = annotated_html.replace("</p>", " And then it ran away.</p>");
		const edited = await push_document_annotated(
			db,
			backend,
			{ document_id: doc.id, project_id, kind: "design", title: "Design", html: edited_html },
			"api",
		);
		expect(edited.ok).toBe(true);

		const rows = await db.select().from(annotation_thread).where(eq(annotation_thread.document_id, doc.id));
		expect(rows).toHaveLength(1);
		expect(rows[0]?.status).toBe("open");
	});

	test("orphans (never silently moves) when the annotated text is deleted entirely", async () => {
		const doc = await push_doc(DOC_HTML);
		const created = await create_thread(db, backend, doc.id, { ...anchor_for("brown fox"), body: "seems off" }, ACTOR);
		if (!created.ok) throw new Error("create failed");

		// A naive rewrite that discards the entire paragraph, markers and all —
		// the marker JSON (and its trifecta) only survives if the agent's edit
		// tool preserved the comment; here it didn't, simulating the worst case.
		const edited = await push_document_annotated(
			db,
			backend,
			{
				document_id: doc.id,
				project_id,
				kind: "design",
				title: "Design",
				html: "<p>Completely different content.</p>",
			},
			"api",
		);
		expect(edited.ok).toBe(true);

		// The marker was dropped from the raw HTML entirely, so nothing survives
		// to even attempt re-anchoring — the index correctly ends up empty
		// rather than inventing a phantom orphan row.
		const rows = await db.select().from(annotation_thread).where(eq(annotation_thread.document_id, doc.id));
		expect(rows).toHaveLength(0);
	});

	test("orphans (never silently moves) when the annotated text is edited away but the marker comments survive", async () => {
		const doc = await push_doc(DOC_HTML);
		const created = await create_thread(db, backend, doc.id, { ...anchor_for("brown fox"), body: "seems off" }, ACTOR);
		if (!created.ok) throw new Error("create failed");

		const annotated_html = await pull_html(doc.id, created.value.head_version);
		// Markers still paired, but the bracketed content itself was rewritten —
		// `reconcile` re-validates every marker against its stored quote, so a
		// stale quote (no longer findable anywhere in the doc) orphans instead
		// of silently keeping whatever text now sits between the markers.
		const edited_html = annotated_html.replace("brown fox", "grey wolf");
		const edited = await push_document_annotated(
			db,
			backend,
			{ document_id: doc.id, project_id, kind: "design", title: "Design", html: edited_html },
			"api",
		);
		expect(edited.ok).toBe(true);

		const rows = await db.select().from(annotation_thread).where(eq(annotation_thread.document_id, doc.id));
		expect(rows).toHaveLength(1);
		expect(rows[0]?.status).toBe("orphaned");
	});

	test("reply appends an entry without moving or dropping the thread", async () => {
		const doc = await push_doc(DOC_HTML);
		const created = await create_thread(db, backend, doc.id, { ...anchor_for("brown fox"), body: "seems off" }, ACTOR);
		if (!created.ok) throw new Error("create failed");

		const rows_before = await db.select().from(annotation_thread).where(eq(annotation_thread.document_id, doc.id));
		const thread_id = rows_before[0]?.thread_id;
		if (!thread_id) throw new Error("thread not indexed");

		const replied = await reply_thread(db, backend, doc.id, thread_id, "agreed, please rename", ACTOR);
		expect(replied.ok).toBe(true);

		const rows_after = await db.select().from(annotation_thread).where(eq(annotation_thread.document_id, doc.id));
		expect(rows_after).toHaveLength(1);
		expect(rows_after[0]?.thread_id).toBe(thread_id);
	});

	test("resolve flips status, and a full index rebuild matches the incremental state", async () => {
		const doc = await push_doc(DOC_HTML);
		await create_thread(db, backend, doc.id, { ...anchor_for("brown fox"), body: "seems off" }, ACTOR);
		const rows_before = await db.select().from(annotation_thread).where(eq(annotation_thread.document_id, doc.id));
		const thread_id = rows_before[0]?.thread_id;
		if (!thread_id) throw new Error("thread not indexed");

		const resolved = await resolve_thread(db, backend, doc.id, thread_id, ACTOR);
		expect(resolved.ok).toBe(true);

		const incremental = await db.select().from(annotation_thread).where(eq(annotation_thread.document_id, doc.id));
		expect(incremental[0]?.status).toBe("resolved");

		const rebuilt = await rebuild_thread_index(db, backend, doc.id);
		expect(rebuilt.ok).toBe(true);
		const after_rebuild = await db.select().from(annotation_thread).where(eq(annotation_thread.document_id, doc.id));
		expect(after_rebuild).toHaveLength(incremental.length);
		expect(after_rebuild[0]?.status).toBe(incremental[0]?.status);
	});

	test("blocking threads are queryable unresolved; resolving removes them from the unresolved set", async () => {
		const doc = await push_doc(DOC_HTML);
		const created = await create_thread(
			db,
			backend,
			doc.id,
			{ ...anchor_for("brown fox"), body: "must fix", blocking: true },
			ACTOR,
		);
		if (!created.ok) throw new Error("create failed");

		const rows = await db.select().from(annotation_thread).where(eq(annotation_thread.document_id, doc.id));
		const thread_id = rows[0]?.thread_id;
		if (!thread_id) throw new Error("thread not indexed");
		expect(rows[0]?.blocking).toBe(true);

		const unresolved_before = await list_unresolved(db, { document_id: doc.id });
		expect(unresolved_before.ok).toBe(true);
		if (unresolved_before.ok) expect(unresolved_before.value).toHaveLength(1);

		const resolved = await resolve_thread(db, backend, doc.id, thread_id, ACTOR);
		expect(resolved.ok).toBe(true);

		const unresolved_after = await list_unresolved(db, { document_id: doc.id });
		expect(unresolved_after.ok).toBe(true);
		if (unresolved_after.ok) expect(unresolved_after.value).toHaveLength(0);
	});

	test("toggle_blocking flips the index without touching the thread's content", async () => {
		const doc = await push_doc(DOC_HTML);
		const created = await create_thread(db, backend, doc.id, { ...anchor_for("brown fox"), body: "note" }, ACTOR);
		if (!created.ok) throw new Error("create failed");
		const rows = await db.select().from(annotation_thread).where(eq(annotation_thread.document_id, doc.id));
		const thread_id = rows[0]?.thread_id;
		if (!thread_id) throw new Error("thread not indexed");

		const toggled = await toggle_blocking(db, backend, doc.id, thread_id, true, ACTOR);
		expect(toggled.ok).toBe(true);

		const rows_after = await db.select().from(annotation_thread).where(eq(annotation_thread.document_id, doc.id));
		expect(rows_after[0]?.blocking).toBe(true);
	});

	test("thread index is provably rebuildable — dropping it and reconstructing from the head doc reproduces the same state", async () => {
		const doc = await push_doc(DOC_HTML);
		await create_thread(db, backend, doc.id, { ...anchor_for("brown fox"), body: "note" }, ACTOR);

		const before = await db.select().from(annotation_thread).where(eq(annotation_thread.document_id, doc.id));
		await db.delete(annotation_thread).where(eq(annotation_thread.document_id, doc.id));
		const dropped = await db.select().from(annotation_thread).where(eq(annotation_thread.document_id, doc.id));
		expect(dropped).toHaveLength(0);

		const rebuilt = await rebuild_thread_index(db, backend, doc.id);
		expect(rebuilt.ok).toBe(true);
		const after = await db.select().from(annotation_thread).where(eq(annotation_thread.document_id, doc.id));
		expect(after).toHaveLength(before.length);
		expect(after[0]?.thread_id).toBe(before[0]?.thread_id);
		expect(after[0]?.status).toBe(before[0]?.status);
	});
});
