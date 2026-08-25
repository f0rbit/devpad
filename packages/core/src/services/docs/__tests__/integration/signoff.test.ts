import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "@devpad/schema/database/types";
import { type Backend, create_memory_backend } from "@f0rbit/corpus";
import { create_thread } from "../../threads.js";
import { decide_checkpoint, latest_decided_signoff, push_interface_report, request_checkpoint } from "../../signoff.js";
import { get_version, push_document } from "../../store.js";
import { graph } from "../../../index.js";
import { create_test_db, seed_project, seed_task, seed_user } from "./helpers.js";

const BASE_TEXT = "The quick brown fox jumps over the lazy dog.";
const DOC_HTML = `<p>${BASE_TEXT}</p>`;

describe("signoff — checkpoint request + human-only decision (task A4.3)", () => {
	let db: Database;
	let backend: Backend;
	let owner_id: string;
	let project_id: string;

	beforeEach(async () => {
		db = create_test_db();
		backend = create_memory_backend();
		const owner = await seed_user(db);
		owner_id = owner.id;
		const project = await seed_project(db, owner_id);
		project_id = project.id;
	});

	test("request_checkpoint creates a blocking approval node; the downstream task is not ready until it's approved", async () => {
		const downstream = await seed_task(db, owner_id, { project_id });

		const requested = await request_checkpoint(
			db,
			{ project_id, subject_kind: "stage", subject_id: "some-stage", checkpoint: "plan", blocks: [downstream.id] },
			{ owner_id, auth_channel: "api" },
		);
		expect(requested.ok).toBe(true);
		if (!requested.ok) return;

		const before = await graph.ready(db, { owner_id, project_id, limit: 20 });
		expect(before.ok).toBe(true);
		if (before.ok) expect(before.value.items.some((t) => t.id === downstream.id)).toBe(false);

		const decided = await decide_checkpoint(
			db,
			backend,
			requested.value.signoff.id,
			{ decision: "approved" },
			{ user_id: owner_id, auth_channel: "user" },
		);
		expect(decided.ok).toBe(true);

		const after = await graph.ready(db, { owner_id, project_id, limit: 20 });
		expect(after.ok).toBe(true);
		if (after.ok) expect(after.value.items.some((t) => t.id === downstream.id)).toBe(true);
	});

	test("an api-channel decision attempt is rejected with approval_channel, regardless of decision value", async () => {
		const requested = await request_checkpoint(
			db,
			{ project_id, subject_kind: "stage", subject_id: "some-stage", checkpoint: "plan", blocks: [] },
			{ owner_id, auth_channel: "api" },
		);
		if (!requested.ok) throw new Error("request failed");

		const result = await decide_checkpoint(
			db,
			backend,
			requested.value.signoff.id,
			{ decision: "approved" },
			{ user_id: owner_id, auth_channel: "api" },
		);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("approval_channel");
	});

	test("approving a doc_version subject stamps content_hash and promotes the corpus version", async () => {
		const pushed = await push_document(db, backend, { project_id, kind: "plan", title: "Plan", html: DOC_HTML }, "api");
		if (!pushed.ok) throw new Error("push failed");

		const requested = await request_checkpoint(
			db,
			{ project_id, subject_kind: "doc_version", subject_id: pushed.value.id, checkpoint: "plan", blocks: [] },
			{ owner_id, auth_channel: "api" },
		);
		if (!requested.ok) throw new Error("request failed");

		const decided = await decide_checkpoint(
			db,
			backend,
			requested.value.signoff.id,
			{ decision: "approved" },
			{ user_id: owner_id, auth_channel: "user" },
		);
		expect(decided.ok).toBe(true);
		if (!decided.ok) return;
		expect(decided.value.content_hash).not.toBeNull();
		expect(decided.value.decided_by).toBe(owner_id);
	});

	test("an open blocking annotation thread on the doc_version subject vetoes approval", async () => {
		const pushed = await push_document(db, backend, { project_id, kind: "plan", title: "Plan", html: DOC_HTML }, "api");
		if (!pushed.ok) throw new Error("push failed");

		const start = DOC_HTML.indexOf("brown fox");
		const created = await create_thread(
			db,
			backend,
			pushed.value.id,
			{
				quote: "brown fox",
				prefix: DOC_HTML.slice(Math.max(0, start - 10), start),
				suffix: DOC_HTML.slice(start + 9, start + 19),
				start,
				end: start + 9,
				body: "must fix before approval",
				blocking: true,
			},
			{ author: owner_id, channel: "user" },
		);
		if (!created.ok) throw new Error("create thread failed");

		const requested = await request_checkpoint(
			db,
			{ project_id, subject_kind: "doc_version", subject_id: pushed.value.id, checkpoint: "plan", blocks: [] },
			{ owner_id, auth_channel: "api" },
		);
		if (!requested.ok) throw new Error("request failed");

		const decided = await decide_checkpoint(
			db,
			backend,
			requested.value.signoff.id,
			{ decision: "approved" },
			{ user_id: owner_id, auth_channel: "user" },
		);

		expect(decided.ok).toBe(false);
		if (decided.ok) return;
		expect(decided.error.kind).toBe("conflict");
	});

	test("changes_requested records the decision without completing the approval task", async () => {
		const downstream = await seed_task(db, owner_id, { project_id });
		const requested = await request_checkpoint(
			db,
			{ project_id, subject_kind: "stage", subject_id: "some-stage", checkpoint: "plan", blocks: [downstream.id] },
			{ owner_id, auth_channel: "api" },
		);
		if (!requested.ok) throw new Error("request failed");

		const decided = await decide_checkpoint(
			db,
			backend,
			requested.value.signoff.id,
			{ decision: "changes_requested", reason: "needs more detail" },
			{ user_id: owner_id, auth_channel: "user" },
		);
		expect(decided.ok).toBe(true);
		if (!decided.ok) return;
		expect(decided.value.decision).toBe("changes_requested");
		expect(decided.value.content_hash).toBeNull();

		const after = await graph.ready(db, { owner_id, project_id, limit: 20 });
		expect(after.ok).toBe(true);
		if (after.ok) expect(after.value.items.some((t) => t.id === downstream.id)).toBe(false);
	});

	test("deciding an already-decided signoff is rejected", async () => {
		const requested = await request_checkpoint(
			db,
			{ project_id, subject_kind: "stage", subject_id: "some-stage", checkpoint: "plan", blocks: [] },
			{ owner_id, auth_channel: "api" },
		);
		if (!requested.ok) throw new Error("request failed");

		const first = await decide_checkpoint(
			db,
			backend,
			requested.value.signoff.id,
			{ decision: "approved" },
			{ user_id: owner_id, auth_channel: "user" },
		);
		expect(first.ok).toBe(true);

		const second = await decide_checkpoint(
			db,
			backend,
			requested.value.signoff.id,
			{ decision: "approved" },
			{ user_id: owner_id, auth_channel: "user" },
		);
		expect(second.ok).toBe(false);
	});
});

describe("push_interface_report — server-verified additive/breaking fast path (task A4.4)", () => {
	let db: Database;
	let backend: Backend;
	let owner_id: string;
	let project_id: string;

	beforeEach(async () => {
		db = create_test_db();
		backend = create_memory_backend();
		const owner = await seed_user(db);
		owner_id = owner.id;
		const project = await seed_project(db, owner_id);
		project_id = project.id;
	});

	test("a first push has no base to compare against and never auto-approves", async () => {
		const result = await push_interface_report(
			db,
			backend,
			{ project_id, title: "my-pkg", normalized: "export type A = string;" },
			{ auth_channel: "api" },
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.classification).toBe("unchanged");
		expect(result.value.signoff).toBeNull();
	});

	test("an additive push against an approved base auto-approves without a human", async () => {
		const first = await push_interface_report(
			db,
			backend,
			{ project_id, title: "my-pkg", normalized: "export type A = string;" },
			{ auth_channel: "api" },
		);
		if (!first.ok) throw new Error("first push failed");

		const requested = await request_checkpoint(
			db,
			{ project_id, subject_kind: "doc_version", subject_id: first.value.document.id, checkpoint: "types", blocks: [] },
			{ owner_id, auth_channel: "api" },
		);
		if (!requested.ok) throw new Error("request failed");
		const decided = await decide_checkpoint(
			db,
			backend,
			requested.value.signoff.id,
			{ decision: "approved" },
			{ user_id: owner_id, auth_channel: "user" },
		);
		expect(decided.ok).toBe(true);

		const second = await push_interface_report(
			db,
			backend,
			{
				document_id: first.value.document.id,
				project_id,
				title: "my-pkg",
				normalized: "export type A = string;\nexport type B = number;",
			},
			{ auth_channel: "api" },
		);
		expect(second.ok).toBe(true);
		if (!second.ok) return;
		expect(second.value.classification).toBe("additive");
		expect(second.value.signoff?.decision).toBe("auto");

		const latest = await latest_decided_signoff(db, "doc_version", first.value.document.id, "types");
		expect(latest.ok).toBe(true);
		if (latest.ok) expect(latest.value?.decision).toBe("auto");
	});

	test("a breaking push against an approved base never auto-approves", async () => {
		const first = await push_interface_report(
			db,
			backend,
			{ project_id, title: "my-pkg", normalized: "export type A = string;" },
			{ auth_channel: "api" },
		);
		if (!first.ok) throw new Error("first push failed");
		const requested = await request_checkpoint(
			db,
			{ project_id, subject_kind: "doc_version", subject_id: first.value.document.id, checkpoint: "types", blocks: [] },
			{ owner_id, auth_channel: "api" },
		);
		if (!requested.ok) throw new Error("request failed");
		await decide_checkpoint(
			db,
			backend,
			requested.value.signoff.id,
			{ decision: "approved" },
			{ user_id: owner_id, auth_channel: "user" },
		);

		const second = await push_interface_report(
			db,
			backend,
			{ document_id: first.value.document.id, project_id, title: "my-pkg", normalized: "export type A = number;" },
			{ auth_channel: "api" },
		);
		expect(second.ok).toBe(true);
		if (!second.ok) return;
		expect(second.value.classification).toBe("breaking");
		expect(second.value.signoff).toBeNull();
	});

	test("escapes hostile content before storage — a route caller bypassing tsc entirely never lands raw markup in corpus", async () => {
		const hostile = '<script>alert(1)</script>\nexport type A = "<img src=x onerror=alert(1)>";';
		const pushed = await push_interface_report(
			db,
			backend,
			{ project_id, title: "my-pkg", normalized: hostile },
			{ auth_channel: "api" },
		);
		expect(pushed.ok).toBe(true);
		if (!pushed.ok) return;
		expect(pushed.value.document.head_version).not.toBeNull();

		const stored = await get_version(
			backend,
			pushed.value.document.id,
			pushed.value.document.head_version ?? undefined,
		);
		expect(stored.ok).toBe(true);
		if (!stored.ok) return;
		expect(stored.value.html).not.toContain("<script");
		expect(stored.value.html).not.toContain("<img");
		expect(stored.value.html).toContain("&lt;script&gt;");
	});
});
