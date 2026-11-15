/**
 * @module pipelines/__tests__/integration/grant-request-route
 *
 * `POST /grants` — admin-only grant REQUEST route (#155 onboarding).
 * Creates a pending `pipeline_grant` for (package, stage, scope) that a
 * human then approves via the existing human-only
 * `POST /grants/:id/approve`. Auth contract mirrors `/oidc-trust`:
 * admin bearer ok, session JWTs 403, unauthenticated 401, unset gate
 * 503 fail-closed. Auto-approval stays policy-table-driven
 * (`is_auto_approvable`) — `github:dispatch:*` is never auto-approved.
 */

import { describe, expect, test } from "bun:test";
import { pipeline_grant } from "@devpad/schema/database/schema";
import type { PipelineGrant } from "@devpad/schema";
import type { Database } from "@devpad/schema/database/types";
import { eq } from "drizzle-orm";
import { build_harness, post_json, test_human_headers, TEST_SESSION_TOKEN } from "./helpers";

const session_headers = { authorization: `Bearer ${TEST_SESSION_TOKEN}` };
const no_headers = {};

const grant_rows = async (db: Database, package_id: string): Promise<PipelineGrant[]> =>
	db.select().from(pipeline_grant).where(eq(pipeline_grant.package_id, package_id));

const error_code_of = (body: { ok: boolean; error?: unknown }): string | undefined => {
	const error = body.error as { code?: string } | undefined;
	return error?.code;
};

const CHAMBER_DISPATCH_SCOPE = "github:dispatch:f0rbit/chamber/deploy.yml";

describe("POST /grants — admin-only grant request", () => {
	test("unauthenticated request returns 401", async () => {
		const h = await build_harness();
		const res = await post_json(
			h.app,
			"/grants",
			{ package_id: h.pkg.id, stage_name: "production", scope: CHAMBER_DISPATCH_SCOPE },
			no_headers,
		);
		expect(res.status).toBe(401);
		expect(error_code_of(res.body)).toBe("unauthorized");
	});

	test("session (OIDC CI) identity returns 403 forbidden", async () => {
		const h = await build_harness({
			session: { scope: ["runs:start", "packages:write"], package_ids: [] },
		});
		const res = await post_json(
			h.app,
			"/grants",
			{ package_id: h.pkg.id, stage_name: "production", scope: CHAMBER_DISPATCH_SCOPE },
			session_headers,
		);
		expect(res.status).toBe(403);
		expect(error_code_of(res.body)).toBe("forbidden");
	});

	test("unset auth gate fails closed with 503 auth_unavailable", async () => {
		const h = await build_harness({ auth: null });
		const res = await post_json(h.app, "/grants", {
			package_id: h.pkg.id,
			stage_name: "production",
			scope: CHAMBER_DISPATCH_SCOPE,
		});
		expect(res.status).toBe(503);
		expect(error_code_of(res.body)).toBe("auth_unavailable");
	});

	test("admin request creates a PENDING grant (201, granted_by null)", async () => {
		const h = await build_harness();
		const res = await post_json(h.app, "/grants", {
			package_id: h.pkg.id,
			stage_name: "production",
			scope: CHAMBER_DISPATCH_SCOPE,
		});
		expect(res.status).toBe(201);
		expect(res.body.ok).toBe(true);
		const grant = res.body.value as PipelineGrant;
		expect(grant.package_id).toBe(h.pkg.id);
		expect(grant.stage_name).toBe("production");
		expect(grant.scope).toBe(CHAMBER_DISPATCH_SCOPE);
		expect(grant.granted_by).toBeNull();
		expect(grant.granted_at).toBeNull();
	});

	test("github:dispatch scope is never auto-approved — always lands pending", async () => {
		const h = await build_harness();
		const res = await post_json(h.app, "/grants", {
			package_id: h.pkg.id,
			stage_name: "staging",
			scope: CHAMBER_DISPATCH_SCOPE,
		});
		expect(res.status).toBe(201);
		const grant = res.body.value as PipelineGrant;
		expect(grant.granted_by).toBeNull();
		expect(grant.granted_at).toBeNull();

		const rows = await grant_rows(h.db, h.pkg.id);
		expect(rows).toHaveLength(1);
	});

	test("unknown package returns 404 not_found", async () => {
		const h = await build_harness();
		const res = await post_json(h.app, "/grants", {
			package_id: "pipeline-package_missing",
			stage_name: "production",
			scope: CHAMBER_DISPATCH_SCOPE,
		});
		expect(res.status).toBe(404);
		expect(error_code_of(res.body)).toBe("not_found");
	});

	test("invalid scope returns 400 invalid_body", async () => {
		const h = await build_harness();
		for (const scope of ["no-colon-segments", "UPPERCASE:first", "github:", "github:dispatch:"]) {
			const res = await post_json(h.app, "/grants", {
				package_id: h.pkg.id,
				stage_name: "production",
				scope,
			});
			expect(res.status).toBe(400);
			expect(error_code_of(res.body)).toBe("invalid_body");
		}
		const rows = await grant_rows(h.db, h.pkg.id);
		expect(rows).toHaveLength(0);
	});

	test("duplicate request returns the existing grant (200), no second row", async () => {
		const h = await build_harness();
		const body = { package_id: h.pkg.id, stage_name: "production", scope: CHAMBER_DISPATCH_SCOPE };

		const first = await post_json(h.app, "/grants", body);
		expect(first.status).toBe(201);
		const created = first.body.value as PipelineGrant;

		const second = await post_json(h.app, "/grants", body);
		expect(second.status).toBe(200);
		const returned = second.body.value as PipelineGrant;
		expect(returned.id).toBe(created.id);

		const rows = await grant_rows(h.db, h.pkg.id);
		expect(rows).toHaveLength(1);
	});

	test("human approve via the existing route flips the pending grant", async () => {
		const h = await build_harness();
		const created_res = await post_json(h.app, "/grants", {
			package_id: h.pkg.id,
			stage_name: "production",
			scope: CHAMBER_DISPATCH_SCOPE,
		});
		expect(created_res.status).toBe(201);
		const grant = created_res.body.value as PipelineGrant;

		const approved = await post_json(h.app, `/grants/${grant.id}/approve`, {}, test_human_headers("user_test"));
		expect(approved.status).toBe(200);
		const approved_grant = approved.body.value as PipelineGrant;
		expect(approved_grant.granted_by).toBe("user_test");
		expect(approved_grant.granted_at).not.toBeNull();
	});

	test("policy-table auto-approval still applies to its own scope (anthropic:messages@staging)", async () => {
		const h = await build_harness();
		const res = await post_json(h.app, "/grants", {
			package_id: h.pkg.id,
			stage_name: "staging",
			scope: "anthropic:messages",
		});
		expect(res.status).toBe(201);
		const grant = res.body.value as PipelineGrant;
		expect(grant.granted_by).toBe("system:auto-approve");
		expect(grant.granted_at).not.toBeNull();
	});
});
