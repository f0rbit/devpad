import { Database as BunSqlite } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { pipeline_grant, pipeline_package, pipeline_run, session, user as user_table } from "@devpad/schema";
import { createBunDatabase } from "@devpad/schema/database/bun";
import { setupIntegration } from "../shared/base-integration-test";
import { getPipelinesUpstreamCalls, resetPipelinesUpstreamCalls, TEST_BASE_URL, TEST_USER_ID } from "./setup";

const t = setupIntegration();

/**
 * Issue #156 — server-to-server pipelines proxy on the main worker.
 *
 * Every `client.pipelines.*` call resolves against the devpad base URL and
 * is proxied (devpad auth + ownership + actor identity) to the pipelines
 * orchestrator stub started by `./setup.ts`. Cookie (user-channel) calls
 * use raw `fetch` + `Cookie` header — same pattern as signoff.test.ts.
 */

const OTHER_USER_ID = "test-user-pipelines-other";
const OWNED_PACKAGE_ID = "pipeline-package_proxy_owned";
const OTHER_PACKAGE_ID = "pipeline-package_proxy_other";
const OWNED_GRANT_ID = "pipeline-grant_proxy_owned";
const OTHER_GRANT_ID = "pipeline-grant_proxy_other";

let owned_run_id = "";
let unowned_run_id = "";
let user_cookie = "";

const open_test_db = () => {
	const db_path = process.env.DATABASE_FILE;
	if (!db_path) throw new Error("DATABASE_FILE not set — integration setup must run first");
	const sqlite = new BunSqlite(db_path);
	return {
		db: createBunDatabase(sqlite),
		close: () => {
			sqlite.close();
		},
	};
};

async function create_user_session_cookie(): Promise<string> {
	const { db, close } = open_test_db();
	const session_id = crypto.randomUUID();
	const expires_at = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30;
	await db
		.insert(session)
		.values({ id: session_id, userId: TEST_USER_ID, expiresAt: expires_at, access_token: "test-access-token" });
	close();
	return `auth_session=${session_id}`;
}

const upstream_calls_for = (path_fragment: string) =>
	getPipelinesUpstreamCalls().filter((call) => call.path.includes(path_fragment));

describe("Pipelines proxy (issue #156)", () => {
	beforeAll(async () => {
		const { db, close } = open_test_db();

		await db
			.insert(user_table)
			.values({ id: OTHER_USER_ID, name: "Other Pipelines User", github_id: 910_000_002 })
			.onConflictDoNothing();

		await db.insert(pipeline_package).values({ id: OWNED_PACKAGE_ID, owner_id: TEST_USER_ID, name: "proxy-owned" });
		await db.insert(pipeline_package).values({ id: OTHER_PACKAGE_ID, owner_id: OTHER_USER_ID, name: "proxy-other" });

		const inserted_runs = await db
			.insert(pipeline_run)
			.values([
				{
					package_id: OWNED_PACKAGE_ID,
					version_set_id: "vs_proxy_owned",
					shape: "gradual",
					resolved_rollout: {},
					resolved_gates: {},
				},
				{
					package_id: OTHER_PACKAGE_ID,
					version_set_id: "vs_proxy_other",
					shape: "gradual",
					resolved_rollout: {},
					resolved_gates: {},
				},
			])
			.returning({ id: pipeline_run.id, package_id: pipeline_run.package_id });

		await db.insert(pipeline_grant).values([
			{ id: OWNED_GRANT_ID, package_id: OWNED_PACKAGE_ID, stage_name: "production", scope: "anthropic:messages" },
			{ id: OTHER_GRANT_ID, package_id: OTHER_PACKAGE_ID, stage_name: "production", scope: "anthropic:messages" },
		]);

		close();

		owned_run_id = inserted_runs.find((r) => r.package_id === OWNED_PACKAGE_ID)?.id ?? "";
		unowned_run_id = inserted_runs.find((r) => r.package_id === OTHER_PACKAGE_ID)?.id ?? "";
		if (owned_run_id === "" || unowned_run_id === "") throw new Error("run fixtures missing");

		user_cookie = await create_user_session_cookie();
	});

	afterAll(async () => {
		if (!process.env.DATABASE_FILE) return;
		const { db, close } = open_test_db();
		await db.delete(pipeline_grant).where(inArray(pipeline_grant.package_id, [OWNED_PACKAGE_ID, OTHER_PACKAGE_ID]));
		await db.delete(pipeline_run).where(inArray(pipeline_run.package_id, [OWNED_PACKAGE_ID, OTHER_PACKAGE_ID]));
		await db.delete(pipeline_package).where(inArray(pipeline_package.id, [OWNED_PACKAGE_ID, OTHER_PACKAGE_ID]));
		await db.delete(user_table).where(eq(user_table.id, OTHER_USER_ID));
		close();
	});

	test("unauthenticated approve is rejected with 401 and never forwarded", async () => {
		resetPipelinesUpstreamCalls();
		const res = await fetch(`${TEST_BASE_URL}/runs/${owned_run_id}/approve`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ stage_name: "production", decision: "approved" }),
		});
		expect(res.status).toBe(401);
		expect(upstream_calls_for("/runs/").length).toBe(0);
	});

	test("api-key approve is human-only — 403 human_approval_required, not forwarded", async () => {
		resetPipelinesUpstreamCalls();
		const result = await t.client.pipelines.approve(owned_run_id, {
			stage_name: "production",
			decision: "approved",
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.message).toBe("human_approval_required");
		expect(result.error.status_code).toBe(403);
		expect(upstream_calls_for("/approve").length).toBe(0);
	});

	test("cookie grant approve on a package the user doesn't own → 404, not forwarded", async () => {
		resetPipelinesUpstreamCalls();
		const res = await fetch(`${TEST_BASE_URL}/grants/${OTHER_GRANT_ID}/approve`, {
			method: "POST",
			headers: { "content-type": "application/json", cookie: user_cookie },
			body: JSON.stringify({ user_id: TEST_USER_ID }),
		});
		expect(res.status).toBe(404);
		const body: unknown = await res.json();
		expect(body).toMatchObject({ error: "Not found" });
		expect(upstream_calls_for("/grants/").length).toBe(0);
	});

	test("cookie approve on an owned package forwards actor headers and strips identity claims", async () => {
		resetPipelinesUpstreamCalls();
		const res = await fetch(`${TEST_BASE_URL}/runs/${owned_run_id}/approve`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				cookie: user_cookie,
				// Client-supplied actor identity must never reach the
				// orchestrator — the proxy builds its own header map.
				"X-Devpad-Actor": "attacker-supplied-id",
				"X-Devpad-Actor-Channel": "api",
			},
			body: JSON.stringify({
				stage_name: "production",
				decision: "approved",
				// A forged user_id in the body must be dropped by the proxy too —
				// the recorded approver always comes from auth, never the body.
				user_id: "attacker-supplied-id",
				reason: "looks good",
			}),
		});
		expect(res.status).toBe(200);

		const calls = upstream_calls_for("/approve");
		expect(calls.length).toBe(1);
		const call = calls.at(0);
		if (!call) throw new Error("no upstream call recorded");
		expect(call.authorization).toBe("Bearer test-pipelines-token");
		expect(call.actor).toBe(TEST_USER_ID);
		expect(call.actor_channel).toBe("user");

		const forwarded: unknown = JSON.parse(call.body);
		expect(forwarded).toMatchObject({ stage_name: "production", reason: "looks good" });
		expect(forwarded).not.toHaveProperty("user_id");
	});

	test("cookie approve on a run inside a package the user doesn't own → 404 (existence not leaked)", async () => {
		resetPipelinesUpstreamCalls();
		const res = await fetch(`${TEST_BASE_URL}/runs/${unowned_run_id}/approve`, {
			method: "POST",
			headers: { "content-type": "application/json", cookie: user_cookie },
			body: JSON.stringify({ stage_name: "production", decision: "approved" }),
		});
		expect(res.status).toBe(404);
		expect(upstream_calls_for("/approve").length).toBe(0);
	});

	test("api-key cancel on an owned package forwards with channel api", async () => {
		resetPipelinesUpstreamCalls();
		const result = await t.client.pipelines.cancel(owned_run_id);
		expect(result.ok).toBe(true);

		const calls = upstream_calls_for("/cancel");
		expect(calls.length).toBe(1);
		const call = calls.at(0);
		if (!call) throw new Error("no upstream call recorded");
		expect(call.authorization).toBe("Bearer test-pipelines-token");
		expect(call.actor).toBe(TEST_USER_ID);
		expect(call.actor_channel).toBe("api");
		// user_id stripped even on the body-less mutation path.
		expect(call.body).not.toContain("user_id");
	});

	test("api-key redispatch is human-only — 403 human_approval_required, not forwarded", async () => {
		resetPipelinesUpstreamCalls();
		const result = await t.client.pipelines.redispatch(owned_run_id);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.message).toBe("human_approval_required");
		expect(result.error.status_code).toBe(403);
		expect(upstream_calls_for("/redispatch").length).toBe(0);
	});

	test("cookie redispatch on an owned run forwards with actor headers (user channel)", async () => {
		resetPipelinesUpstreamCalls();
		const res = await fetch(`${TEST_BASE_URL}/runs/${owned_run_id}/redispatch`, {
			method: "POST",
			headers: { "content-type": "application/json", cookie: user_cookie },
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(200);

		const calls = upstream_calls_for("/redispatch");
		expect(calls.length).toBe(1);
		const call = calls.at(0);
		if (!call) throw new Error("no upstream call recorded");
		expect(call.authorization).toBe("Bearer test-pipelines-token");
		expect(call.actor).toBe(TEST_USER_ID);
		expect(call.actor_channel).toBe("user");
	});

	test("dispatches GET on an unowned run → 404, not forwarded", async () => {
		resetPipelinesUpstreamCalls();
		const res = await fetch(`${TEST_BASE_URL}/runs/${unowned_run_id}/dispatches`, {
			method: "GET",
			headers: { "content-type": "application/json", cookie: user_cookie },
		});
		expect(res.status).toBe(404);
		const body: unknown = await res.json();
		expect(body).toMatchObject({ error: "Not found" });
		expect(upstream_calls_for("/dispatches").length).toBe(0);
	});

	test("dispatches GET on an owned run forwards to the orchestrator", async () => {
		resetPipelinesUpstreamCalls();
		const res = await fetch(`${TEST_BASE_URL}/runs/${owned_run_id}/dispatches`, {
			method: "GET",
			headers: { "content-type": "application/json", cookie: user_cookie },
		});
		expect(res.status).toBe(200);

		const calls = upstream_calls_for("/dispatches");
		expect(calls.length).toBe(1);
		const call = calls.at(0);
		if (!call) throw new Error("no upstream call recorded");
		expect(call.actor).toBe(TEST_USER_ID);
		expect(call.actor_channel).toBe("user");
	});
});
