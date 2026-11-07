/**
 * @module pipelines/__tests__/integration/approvals-auth
 *
 * Auth contract for mutating routes (issue #156). The devpad main Worker
 * is the ONLY caller that may act on behalf of a human: it authenticates
 * the user itself, checks package ownership, and forwards with the admin
 * bearer plus two headers:
 *
 *   `X-Devpad-Actor: <devpad user id>`
 *   `X-Devpad-Actor-Channel: user | api`
 *
 * Headers are honoured only for the admin identity. Manual approve/deny
 * routes are HUMAN ONLY (channel `user`); cancel/rollback accept admin or
 * a scoped session identity; every mutating route fails closed to 503
 * `auth_unavailable` when the auth gate is not wired.
 */

import { describe, expect, test } from "bun:test";
import { pipeline_approval, pipeline_grant } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { eq } from "drizzle-orm";
import {
	approve,
	build_harness,
	post_json,
	test_admin_headers,
	test_human_headers,
	TEST_SESSION_TOKEN,
} from "./helpers";

const session_headers = { authorization: `Bearer ${TEST_SESSION_TOKEN}` };
const no_headers = {};
const api_channel_only = { "x-devpad-actor-channel": "api" };

const approval_row_for = async (db: Database, run_id: string) =>
	(await db.select().from(pipeline_approval).where(eq(pipeline_approval.run_id, run_id)))[0];

const grant_row_of = async (db: Database, grant_id: string) =>
	(await db.select().from(pipeline_grant).where(eq(pipeline_grant.id, grant_id)))[0];

const seed_pending_grant = async (db: Database, grant_id: string, package_id: string): Promise<void> => {
	const now = new Date().toISOString();
	await db.insert(pipeline_grant).values({
		id: grant_id,
		package_id,
		stage_name: "production",
		scope: "custom:manual",
		granted_by: null,
		granted_at: null,
		created_at: now,
		updated_at: now,
		created_by: "api",
		modified_by: "api",
		protected: false,
		deleted: false,
	});
};

const error_code_of = (body: { ok: boolean; error?: unknown }): string | undefined => {
	const error = body.error as { code?: string } | undefined;
	return error?.code;
};

const create_run = async (
	app: Awaited<ReturnType<typeof build_harness>>["app"],
	package_id: string,
): Promise<string> => {
	const res = await post_json(app, "/runs", { package_id, version_set_id: "vs_v1" });
	if (!res.body.ok) throw new Error(`run creation failed: ${JSON.stringify(res.body.error)}`);
	return (res.body.value as { run_id: string }).run_id;
};

describe("run approve — human-only header contract", () => {
	test("unauthenticated approve returns 401", async () => {
		const h = await build_harness();
		const run_id = await create_run(h.app, h.pkg.id);
		const res = await post_json(
			h.app,
			`/runs/${run_id}/approve`,
			{ stage_name: "onebox", decision: "approved" },
			no_headers,
		);
		expect(res.status).toBe(401);
		expect(error_code_of(res.body)).toBe("unauthorized");
	});

	test("unauthenticated approve returns 401 even with a body user_id — no body-field shortcut", async () => {
		const h = await build_harness();
		const run_id = await create_run(h.app, h.pkg.id);
		const res = await post_json(
			h.app,
			`/runs/${run_id}/approve`,
			{ stage_name: "onebox", decision: "approved", user_id: "user_anyone" },
			no_headers,
		);
		expect(res.status).toBe(401);
	});

	test("session (OIDC CI) identity approve returns 403 human_approval_required", async () => {
		const h = await build_harness({
			session: { scope: ["runs:start", "runs:cancel"], package_ids: ["pipeline-package_test"] },
		});
		const run_id = await create_run(h.app, h.pkg.id);
		const res = await post_json(
			h.app,
			`/runs/${run_id}/approve`,
			{ stage_name: "onebox", decision: "approved" },
			{
				...session_headers,
				"x-devpad-actor": "user_impersonated",
				"x-devpad-actor-channel": "user",
			},
		);
		expect(res.status).toBe(403);
		expect(error_code_of(res.body)).toBe("human_approval_required");
	});

	test("admin without actor header returns 403 human_approval_required", async () => {
		const h = await build_harness();
		const run_id = await create_run(h.app, h.pkg.id);
		const res = await post_json(h.app, `/runs/${run_id}/approve`, { stage_name: "onebox", decision: "approved" });
		expect(res.status).toBe(403);
		expect(error_code_of(res.body)).toBe("human_approval_required");

		// No approval row was written.
		const row = await approval_row_for(h.db, run_id);
		expect(row).toBeUndefined();
	});

	test("admin with channel api returns 403 human_approval_required", async () => {
		const h = await build_harness();
		const run_id = await create_run(h.app, h.pkg.id);
		const res = await post_json(
			h.app,
			`/runs/${run_id}/approve`,
			{ stage_name: "onebox", decision: "approved" },
			{ ...test_admin_headers(), "x-devpad-actor": "user_actor", ...api_channel_only },
		);
		expect(res.status).toBe(403);
		expect(error_code_of(res.body)).toBe("human_approval_required");
	});

	test("admin with missing channel header returns 403 (fail closed)", async () => {
		const h = await build_harness();
		const run_id = await create_run(h.app, h.pkg.id);
		const res = await post_json(
			h.app,
			`/runs/${run_id}/approve`,
			{ stage_name: "onebox", decision: "approved" },
			{ ...test_admin_headers(), "x-devpad-actor": "user_actor" },
		);
		expect(res.status).toBe(403);
		expect(error_code_of(res.body)).toBe("human_approval_required");
	});

	test("admin + actor + channel user approves; decided_by IS the header actor even with a different body user_id", async () => {
		const h = await build_harness();
		const run_id = await create_run(h.app, h.pkg.id);
		const res = await post_json(
			h.app,
			`/runs/${run_id}/approve`,
			{ stage_name: "onebox", decision: "approved", user_id: "user_attacker" },
			test_human_headers("user_test"),
		);
		expect(res.status).toBe(200);
		expect(res.body.ok).toBe(true);

		const row = await approval_row_for(h.db, run_id);
		expect(row).toBeDefined();
		expect(row.decision).toBe("approved");
		expect(row.decided_by).toBe("user_test");
		expect(row.decided_by).not.toBe("user_attacker");
	});
});

describe("grant approve/deny — human-only header contract", () => {
	const GRANT_ID = "pipeline-grant_auth_test";

	test("unauthenticated grant approve + deny return 401", async () => {
		const h = await build_harness();
		await seed_pending_grant(h.db, GRANT_ID, h.pkg.id);

		const approve_res = await post_json(h.app, `/grants/${GRANT_ID}/approve`, { user_id: "user_attacker" }, no_headers);
		expect(approve_res.status).toBe(401);
		expect(error_code_of(approve_res.body)).toBe("unauthorized");

		const deny_res = await post_json(h.app, `/grants/${GRANT_ID}/deny`, { user_id: "user_attacker" }, no_headers);
		expect(deny_res.status).toBe(401);

		const row = await grant_row_of(h.db, GRANT_ID);
		expect(row.granted_by).toBeNull();
	});

	test("session identity on grant decision returns 403 human_approval_required", async () => {
		const h = await build_harness({
			session: { scope: ["packages:write"], package_ids: ["pipeline-package_test"] },
		});
		await seed_pending_grant(h.db, GRANT_ID, h.pkg.id);
		const res = await post_json(
			h.app,
			`/grants/${GRANT_ID}/approve`,
			{}, // body user_id ignored entirely
			{ ...session_headers, "x-devpad-actor": "user_impersonated", "x-devpad-actor-channel": "user" },
		);
		expect(res.status).toBe(403);
		expect(error_code_of(res.body)).toBe("human_approval_required");
	});

	test("admin without actor, or with channel api, returns 403 human_approval_required", async () => {
		const h = await build_harness();
		await seed_pending_grant(h.db, GRANT_ID, h.pkg.id);

		const no_actor = await post_json(h.app, `/grants/${GRANT_ID}/approve`, {});
		expect(no_actor.status).toBe(403);
		expect(error_code_of(no_actor.body)).toBe("human_approval_required");

		const api_channel = await post_json(
			h.app,
			`/grants/${GRANT_ID}/approve`,
			{},
			{ ...test_admin_headers(), "x-devpad-actor": "user_actor", "x-devpad-actor-channel": "api" },
		);
		expect(api_channel.status).toBe(403);
		expect(error_code_of(api_channel.body)).toBe("human_approval_required");

		const api_channel_deny = await post_json(
			h.app,
			`/grants/${GRANT_ID}/deny`,
			{},
			{ ...test_admin_headers(), "x-devpad-actor": "user_actor", "x-devpad-actor-channel": "api" },
		);
		expect(api_channel_deny.status).toBe(403);
		expect(error_code_of(api_channel_deny.body)).toBe("human_approval_required");
	});

	test("admin + actor + channel user approves; granted_by IS the header actor despite a body user_id", async () => {
		const h = await build_harness();
		await seed_pending_grant(h.db, GRANT_ID, h.pkg.id);
		const res = await post_json(
			h.app,
			`/grants/${GRANT_ID}/approve`,
			{ user_id: "user_attacker" },
			test_human_headers("user_test"),
		);
		expect(res.status).toBe(200);
		expect(res.body.ok).toBe(true);

		const row = await grant_row_of(h.db, GRANT_ID);
		expect(row.granted_by).toBe("user_test");
		expect(row.granted_by).not.toBe("user_attacker");
		expect(row.granted_at).not.toBeNull();
	});

	test("admin + actor + channel user denies; granted_by stays null", async () => {
		const h = await build_harness();
		await seed_pending_grant(h.db, GRANT_ID, h.pkg.id);
		const res = await post_json(
			h.app,
			`/grants/${GRANT_ID}/deny`,
			{ user_id: "user_attacker", reason: "nope" },
			test_human_headers("user_actor"),
		);
		expect(res.status).toBe(200);
		expect((res.body.value as { success: boolean }).success).toBe(true);

		const row = await grant_row_of(h.db, GRANT_ID);
		expect(row.granted_by).toBeNull();
		expect(row.granted_at).toBeNull();
	});
});

describe("cancel + rollback — machine routes with session scoping", () => {
	test("unauthenticated cancel returns 401", async () => {
		const h = await build_harness();
		const run_id = await create_run(h.app, h.pkg.id);
		const res = await post_json(h.app, `/runs/${run_id}/cancel`, {}, no_headers);
		expect(res.status).toBe(401);
		expect(error_code_of(res.body)).toBe("unauthorized");
	});

	test("unauthenticated rollback returns 401", async () => {
		const h = await build_harness();
		const run_id = await create_run(h.app, h.pkg.id);
		const res = await post_json(h.app, `/runs/${run_id}/rollback`, {}, no_headers);
		expect(res.status).toBe(401);
		expect(error_code_of(res.body)).toBe("unauthorized");
	});

	test("session without runs:cancel scope returns 403 insufficient_scope", async () => {
		const h = await build_harness({
			session: { scope: ["runs:start"], package_ids: ["pipeline-package_test"] },
		});
		const run_id = await create_run(h.app, h.pkg.id);
		const res = await post_json(h.app, `/runs/${run_id}/cancel`, {}, session_headers);
		expect(res.status).toBe(403);
		expect(error_code_of(res.body)).toBe("insufficient_scope");
	});

	test("session with runs:cancel scope but another package returns 403 package_scope_mismatch", async () => {
		const h = await build_harness({
			session: { scope: ["runs:cancel"], package_ids: ["pipeline-package_other"] },
		});
		const run_id = await create_run(h.app, h.pkg.id);
		const res = await post_json(h.app, `/runs/${run_id}/cancel`, {}, session_headers);
		expect(res.status).toBe(403);
		expect(error_code_of(res.body)).toBe("package_scope_mismatch");
	});

	test("session with runs:cancel scope + package in scope cancels successfully", async () => {
		const h = await build_harness({
			session: { scope: ["runs:cancel"], package_ids: ["pipeline-package_test"] },
		});
		const run_id = await create_run(h.app, h.pkg.id);
		const res = await post_json(h.app, `/runs/${run_id}/cancel`, {}, session_headers);
		expect(res.status).toBe(200);
		expect(res.body.ok).toBe(true);
	});

	test("session without runs:rollback scope returns 403 insufficient_scope", async () => {
		const h = await build_harness({
			session: { scope: ["runs:start"], package_ids: ["pipeline-package_test"] },
		});
		const run_id = await create_run(h.app, h.pkg.id);
		const res = await post_json(h.app, `/runs/${run_id}/rollback`, {}, session_headers);
		expect(res.status).toBe(403);
		expect(error_code_of(res.body)).toBe("insufficient_scope");
	});

	test("session with runs:rollback scope + package in scope rolls back successfully", async () => {
		const h = await build_harness({
			session: { scope: ["runs:rollback"], package_ids: ["pipeline-package_test"] },
		});
		const run_id = await create_run(h.app, h.pkg.id);
		await approve(h.app, run_id, "onebox", "approved");

		const res = await post_json(h.app, `/runs/${run_id}/rollback`, {}, session_headers);
		expect(res.status).toBe(200);
		expect(res.body.ok).toBe(true);
	});
});

describe("fail closed — auth gate not wired returns 503 auth_unavailable", () => {
	test("POST /runs no longer skips the gate when auth is undefined", async () => {
		const h = await build_harness({ auth: null });
		const res = await post_json(h.app, "/runs", { package_id: h.pkg.id, version_set_id: "vs_v1" });
		expect(res.status).toBe(503);
		expect(error_code_of(res.body)).toBe("auth_unavailable");
	});

	test("approve / cancel / rollback return 503 when auth is undefined", async () => {
		const h = await build_harness({ auth: null });
		await seed_pending_grant(h.db, "pipeline-grant_unconfigured", h.pkg.id);

		const approve_res = await post_json(
			h.app,
			"/runs/pipeline-run_missing/approve",
			{ stage_name: "onebox", decision: "approved" },
			test_human_headers("user_actor"), // even a fully-formed human forward is refused
		);
		expect(approve_res.status).toBe(503);
		expect(error_code_of(approve_res.body)).toBe("auth_unavailable");

		const cancel_res = await post_json(h.app, "/runs/pipeline-run_missing/cancel", {});
		expect(cancel_res.status).toBe(503);
		expect(error_code_of(cancel_res.body)).toBe("auth_unavailable");

		const rollback_res = await post_json(h.app, "/runs/pipeline-run_missing/rollback", {});
		expect(rollback_res.status).toBe(503);
		expect(error_code_of(rollback_res.body)).toBe("auth_unavailable");

		const grant_res = await post_json(
			h.app,
			"/grants/pipeline-grant_unconfigured/approve",
			{},
			test_human_headers("user_actor"),
		);
		expect(grant_res.status).toBe(503);
		expect(error_code_of(grant_res.body)).toBe("auth_unavailable");

		const deny_res = await post_json(
			h.app,
			"/grants/pipeline-grant_unconfigured/deny",
			{},
			test_human_headers("user_actor"),
		);
		expect(deny_res.status).toBe(503);
		expect(error_code_of(deny_res.body)).toBe("auth_unavailable");
	});
});
