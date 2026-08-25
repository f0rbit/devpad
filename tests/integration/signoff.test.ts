import { Database as BunSqlite } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { createBunDatabase } from "@devpad/schema/database/bun";
import { session } from "@devpad/schema/database/schema";
import type { Project, TaskWithDetails } from "@devpad/schema";
import { setupIntegration } from "../shared/base-integration-test";
import { TestDataFactory } from "./factories";
import { TEST_BASE_URL, TEST_USER_ID } from "./setup";

const t = setupIntegration();

const BASE_TEXT = "The quick brown fox jumps over the lazy dog.";
const DOC_HTML = `<p>${BASE_TEXT}</p>`;

/**
 * Every other integration test drives the API via `t.client`'s Bearer-token
 * (api-channel) auth. This suite specifically needs the human (`user`-channel,
 * session-cookie) path — `decide_checkpoint` is human-only per task A4.3 — so
 * it inserts a session row directly (mirroring `createSession`'s own logic;
 * no existing test client here supports cookie auth) and drives those calls
 * with a raw `fetch` + `Cookie` header instead of `t.client`.
 */
async function create_user_session_cookie(): Promise<string> {
	const db_path = process.env.DATABASE_FILE;
	if (!db_path) throw new Error("DATABASE_FILE not set — integration setup must run first");
	const sqlite = new BunSqlite(db_path);
	const db = createBunDatabase(sqlite);
	const session_id = crypto.randomUUID();
	const expires_at = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30;
	await db
		.insert(session)
		.values({ id: session_id, userId: TEST_USER_ID, expiresAt: expires_at, access_token: "test-access-token" });
	sqlite.close();
	return `auth_session=${session_id}`;
}

async function decide_as_user(
	cookie: string,
	signoff_id: string,
	body: unknown,
): Promise<{ status: number; json: unknown }> {
	const res = await fetch(`${TEST_BASE_URL}/signoffs/${signoff_id}/decide`, {
		method: "POST",
		headers: { "content-type": "application/json", cookie },
		body: JSON.stringify(body),
	});
	return { status: res.status, json: await res.json() };
}

describe("Signoff — human-approval checkpoint (task A4.3)", () => {
	let project: Project;
	let user_cookie: string;

	beforeEach(async () => {
		const created = await t.client.projects.create(TestDataFactory.createRealisticProject());
		if (!created.ok) throw new Error(`Failed to create project: ${created.error.message}`);
		t.cleanup.registerProject(created.value);
		project = created.value;
		user_cookie = await create_user_session_cookie();
	});

	async function create_downstream_task(): Promise<TaskWithDetails> {
		const result = await t.client.tasks.create({
			title: "Downstream task",
			project_id: project.id,
			owner_id: TEST_USER_ID,
			progress: "UNSTARTED",
			priority: "MEDIUM",
		});
		if (!result.ok) throw new Error(`Failed to create task: ${result.error.message}`);
		t.cleanup.registerTask(result.value);
		return result.value;
	}

	test("an api-channel decision attempt 403s", async () => {
		const requested = await t.client.signoffs.request({
			project_id: project.id,
			subject_kind: "stage",
			subject_id: "build",
			checkpoint: "plan",
			blocks: [],
		});
		expect(requested.ok).toBe(true);
		if (!requested.ok) return;

		const decided = await t.client.signoffs.decide(requested.value.signoff.id, { decision: "approved" });
		expect(decided.ok).toBe(false);
		if (decided.ok) return;
		expect(decided.error.status_code).toBe(403);
	});

	test("a user decision completes the approval node and unblocks READY for gated tasks", async () => {
		const downstream = await create_downstream_task();

		const requested = await t.client.signoffs.request({
			project_id: project.id,
			subject_kind: "stage",
			subject_id: "build",
			checkpoint: "plan",
			blocks: [downstream.task.id],
		});
		expect(requested.ok).toBe(true);
		if (!requested.ok) return;

		const before = await t.client.tasks.ready({ project_id: project.id });
		expect(before.ok).toBe(true);
		if (before.ok) expect(before.value.items.some((item) => item.id === downstream.task.id)).toBe(false);

		const decided = await decide_as_user(user_cookie, requested.value.signoff.id, { decision: "approved" });
		expect(decided.status).toBe(200);

		const after = await t.client.tasks.ready({ project_id: project.id });
		expect(after.ok).toBe(true);
		if (after.ok) expect(after.value.items.some((item) => item.id === downstream.task.id)).toBe(true);
	});

	test("approval is blocked while an open blocking annotation thread exists on the doc_version subject", async () => {
		const pushed = await t.client.docs.push({ project_id: project.id, kind: "plan", title: "Plan", html: DOC_HTML });
		if (!pushed.ok) throw new Error("push failed");

		const start = DOC_HTML.indexOf("brown fox");
		const created = await t.client.docs.createThread(pushed.value.id, {
			quote: "brown fox",
			prefix: DOC_HTML.slice(Math.max(0, start - 10), start),
			suffix: DOC_HTML.slice(start + 9, start + 19),
			start,
			end: start + 9,
			body: "must fix",
			blocking: true,
		});
		expect(created.ok).toBe(true);

		const requested = await t.client.signoffs.request({
			project_id: project.id,
			subject_kind: "doc_version",
			subject_id: pushed.value.id,
			checkpoint: "plan",
			blocks: [],
		});
		if (!requested.ok) throw new Error("request failed");

		const decided = await decide_as_user(user_cookie, requested.value.signoff.id, { decision: "approved" });
		expect(decided.status).toBe(409);
	});

	test("decision rows carry the approved version's content_hash", async () => {
		const pushed = await t.client.docs.push({ project_id: project.id, kind: "plan", title: "Plan", html: DOC_HTML });
		if (!pushed.ok) throw new Error("push failed");

		const requested = await t.client.signoffs.request({
			project_id: project.id,
			subject_kind: "doc_version",
			subject_id: pushed.value.id,
			checkpoint: "plan",
			blocks: [],
		});
		if (!requested.ok) throw new Error("request failed");

		const decided = await decide_as_user(user_cookie, requested.value.signoff.id, { decision: "approved" });
		expect(decided.status).toBe(200);
		const body = decided.json as { content_hash: string | null; decided_by: string };
		expect(body.content_hash).not.toBeNull();
		expect(body.decided_by).toBe(TEST_USER_ID);
	});
});
