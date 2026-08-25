import { beforeEach, describe, expect, test } from "bun:test";
import {
	pipeline_approval,
	pipeline_package,
	pipeline_run,
	tracker_result,
	todo_updates,
} from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { type Backend, create_memory_backend } from "@f0rbit/corpus";
import { create_thread } from "../../threads.js";
import { pending_reviews } from "../../reviews.js";
import { request_checkpoint } from "../../signoff.js";
import { push_document } from "../../store.js";
import { create_test_db, seed_project, seed_user } from "./helpers.js";

const BASE_TEXT = "The quick brown fox jumps over the lazy dog.";
const DOC_HTML = `<p>${BASE_TEXT}</p>`;

describe("pending_reviews — the human's queue aggregate (task A4.6)", () => {
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

	test("empty state is an empty array, not an error", async () => {
		const result = await pending_reviews(db, owner_id);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toEqual([]);
	});

	test("aggregates a pending signoff checkpoint", async () => {
		const requested = await request_checkpoint(
			db,
			{ project_id, subject_kind: "stage", subject_id: "some-stage", checkpoint: "plan", blocks: [] },
			{ owner_id, auth_channel: "api" },
		);
		if (!requested.ok) throw new Error("request failed");

		const result = await pending_reviews(db, owner_id);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const item = result.value.find((i) => i.kind === "signoff");
		expect(item).toBeDefined();
		expect(item?.subject_id).toBe(requested.value.signoff.id);
		expect(item?.project_id).toBe(project_id);
		expect(typeof item?.path).toBe("string");
	});

	test("aggregates an open blocking annotation thread", async () => {
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
				body: "must fix",
				blocking: true,
			},
			{ author: owner_id, channel: "user" },
		);
		if (!created.ok) throw new Error("create thread failed");

		const result = await pending_reviews(db, owner_id);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const item = result.value.find((i) => i.kind === "annotation");
		expect(item).toBeDefined();
		expect(item?.project_id).toBe(project_id);
	});

	test("aggregates a pending pipeline manual gate", async () => {
		const now = new Date().toISOString();
		const package_rows = await db
			.insert(pipeline_package)
			.values({ owner_id, name: "test-pkg", project_id })
			.returning();
		const pkg = package_rows[0];

		const run_rows = await db
			.insert(pipeline_run)
			.values({
				package_id: pkg.id,
				version_set_id: "vs_test",
				shape: "atomic",
				resolved_rollout: { type: "atomic" },
				resolved_gates: {},
			})
			.returning();
		const run = run_rows[0];

		const approval_rows = await db
			.insert(pipeline_approval)
			.values({ run_id: run.id, stage_name: "staging->atomic-prod", created_at: now, updated_at: now })
			.returning();
		const approval = approval_rows[0];

		const result = await pending_reviews(db, owner_id);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const item = result.value.find((i) => i.kind === "pipeline_gate");
		expect(item).toBeDefined();
		expect(item?.subject_id).toBe(approval.id);
		expect(item?.project_id).toBe(project_id);
	});

	test("aggregates a pending scanner diff", async () => {
		const tracker_rows = await db.insert(tracker_result).values({ project_id, data: {} }).returning();
		const tracked = tracker_rows[0];
		const update_rows = await db
			.insert(todo_updates)
			.values({ project_id, new_id: tracked.id, data: {}, status: "PENDING" })
			.returning();
		const scan_diff = update_rows[0];

		const result = await pending_reviews(db, owner_id);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const item = result.value.find((i) => i.kind === "scan_diff");
		expect(item).toBeDefined();
		expect(item?.subject_id).toBe(String(scan_diff.id));
		expect(item?.project_id).toBe(project_id);
	});

	test("all four sources aggregate together with correct shapes", async () => {
		await request_checkpoint(
			db,
			{ project_id, subject_kind: "stage", subject_id: "some-stage", checkpoint: "plan", blocks: [] },
			{ owner_id, auth_channel: "api" },
		);
		const tracker_rows = await db.insert(tracker_result).values({ project_id, data: {} }).returning();
		await db.insert(todo_updates).values({ project_id, new_id: tracker_rows[0].id, data: {}, status: "PENDING" });

		const result = await pending_reviews(db, owner_id);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.length).toBeGreaterThanOrEqual(2);
		for (const item of result.value) {
			expect(typeof item.subject_id).toBe("string");
			expect(typeof item.title).toBe("string");
			expect(typeof item.created_at).toBe("string");
			expect(typeof item.path).toBe("string");
		}
	});

	test("only surfaces items owned by the requesting user", async () => {
		const other_owner = await seed_user(db);
		const other_project = await seed_project(db, other_owner.id);
		await request_checkpoint(
			db,
			{
				project_id: other_project.id,
				subject_kind: "stage",
				subject_id: "other-stage",
				checkpoint: "plan",
				blocks: [],
			},
			{ owner_id: other_owner.id, auth_channel: "api" },
		);

		const result = await pending_reviews(db, owner_id);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toEqual([]);
	});
});
