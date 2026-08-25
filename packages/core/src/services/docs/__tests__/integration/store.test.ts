import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "@devpad/schema/database/types";
import { create_memory_backend, type Backend } from "@f0rbit/corpus";
import { get_version, list_documents, list_versions, promote, push_document } from "../../store.js";
import { create_test_db, seed_project, seed_user } from "./helpers.js";

describe("doc store — push/pull/list round-trips (task A4.1)", () => {
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

	test("push creates a new document and round-trips sanitized content on pull", async () => {
		const pushed = await push_document(
			db,
			backend,
			{ project_id, kind: "plan", title: "My Plan", html: "<h1>Plan</h1><script>alert(1)</script>" },
			"api",
		);
		expect(pushed.ok).toBe(true);
		if (!pushed.ok) return;
		expect(pushed.value.head_version).not.toBeNull();

		const pulled = await get_version(backend, pushed.value.id, pushed.value.head_version ?? undefined);
		expect(pulled.ok).toBe(true);
		if (!pulled.ok) return;
		expect(pulled.value.html).toContain("<h1>Plan</h1>");
		expect(pulled.value.html).not.toContain("<script");
	});

	test("pushing a second version onto an existing document stamps lineage in order", async () => {
		const first = await push_document(
			db,
			backend,
			{ project_id, kind: "plan", title: "v1", html: "<p>one</p>" },
			"api",
		);
		if (!first.ok) throw new Error("push failed");

		const second = await push_document(
			db,
			backend,
			{ document_id: first.value.id, project_id, kind: "plan", title: "v2", html: "<p>two</p>" },
			"api",
		);
		if (!second.ok) throw new Error("push failed");
		expect(second.value.id).toBe(first.value.id);
		expect(second.value.head_version).not.toBe(first.value.head_version);

		const versions = await list_versions(backend, first.value.id);
		expect(versions.ok).toBe(true);
		if (!versions.ok) return;
		expect(versions.value).toHaveLength(2);
		expect(versions.value[0]?.version).toBe(second.value.head_version);
		expect(versions.value[0]?.parent).toBe(first.value.head_version);
	});

	test("list_documents filters by project", async () => {
		await push_document(db, backend, { project_id, kind: "plan", title: "A", html: "<p>a</p>" }, "api");
		const docs = await list_documents(db, { project_id });
		expect(docs.ok).toBe(true);
		if (!docs.ok) return;
		expect(docs.value.length).toBeGreaterThanOrEqual(1);
	});

	test("promote tags a version without creating a new one (zero-copy)", async () => {
		const pushed = await push_document(db, backend, { project_id, kind: "plan", title: "P", html: "<p>p</p>" }, "api");
		if (!pushed.ok) throw new Error("push failed");
		const before = await list_versions(backend, pushed.value.id);
		if (!before.ok) throw new Error("list failed");
		const head_version = pushed.value.head_version;
		if (!head_version) throw new Error("expected head_version");

		const result = await promote(backend, pushed.value.id, head_version, "approved");
		expect(result.ok).toBe(true);

		const after = await list_versions(backend, pushed.value.id);
		if (!after.ok) throw new Error("list failed");
		expect(after.value).toHaveLength(before.value.length);
		expect(after.value[0]?.tags).toContain("approved");
	});
});
