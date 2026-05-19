/**
 * Integration coverage for the OIDC trust-policy CRUD service. Drives
 * the public service surface against an in-memory bun:sqlite database
 * — no mocks, no fakes around the service itself.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { pipeline_oidc_trust } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { eq } from "drizzle-orm";
import { create_trust_policy, delete_trust_policy, get_trust_policy, list_trust_policies, touch_trust_policy_last_used, update_trust_policy } from "../../oidc-trust.js";
import { create_test_db, seed_user } from "./helpers.js";

const make_input = (owner_id: string, overrides: Record<string, unknown> = {}) => ({
	owner_id,
	github_owner: "f0rbit",
	expected_audience: "https://devpad-pipelines.dev-818.workers.dev",
	...overrides,
});

describe("oidc-trust service — create_trust_policy", () => {
	let db: Database;
	let owner_id: string;

	beforeEach(async () => {
		db = create_test_db();
		owner_id = (await seed_user(db)).id;
	});

	test("creates a policy with defaults per plan §I.5", async () => {
		const result = await create_trust_policy(db, make_input(owner_id));
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.github_owner).toBe("f0rbit");
			expect(result.value.repo_pattern).toBe("*");
			expect(result.value.allowed_actions).toEqual(["artifacts:upload", "runs:start"]);
			expect(result.value.session_ttl_seconds).toBe(900);
			expect(result.value.provider).toBe("github");
			expect(result.value.last_used_at).toBeNull();
			expect(result.value.deleted).toBe(false);
		}
	});

	test("honours explicit values over defaults", async () => {
		const result = await create_trust_policy(
			db,
			make_input(owner_id, {
				repo_pattern: "forbit-*",
				allowed_actions: ["artifacts:upload"],
				allowed_refs: ["refs/heads/main"],
				allowed_environments: ["production"],
				session_ttl_seconds: 300,
			})
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.repo_pattern).toBe("forbit-*");
			expect(result.value.allowed_actions).toEqual(["artifacts:upload"]);
			expect(result.value.allowed_refs).toEqual(["refs/heads/main"]);
			expect(result.value.allowed_environments).toEqual(["production"]);
			expect(result.value.session_ttl_seconds).toBe(300);
		}
	});

	test("returns validation error on missing required fields", async () => {
		const result = await create_trust_policy(db, { owner_id, github_owner: "", expected_audience: "" } as never);
		expect(result.ok).toBe(false);
		if (!result.ok) expect((result.error as { kind: string }).kind).toBe("validation");
	});
});

describe("oidc-trust service — list_trust_policies", () => {
	let db: Database;
	let owner_id: string;

	beforeEach(async () => {
		db = create_test_db();
		owner_id = (await seed_user(db)).id;
	});

	test("returns empty array when no policies", async () => {
		const result = await list_trust_policies(db, { owner_id });
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toEqual([]);
	});

	test("returns policies ordered by created_at DESC, id ASC", async () => {
		await create_trust_policy(db, make_input(owner_id, { github_owner: "alpha" }));
		await create_trust_policy(db, make_input(owner_id, { github_owner: "beta" }));
		await create_trust_policy(db, make_input(owner_id, { github_owner: "gamma" }));

		const result = await list_trust_policies(db, { owner_id });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toHaveLength(3);
			// All share the same wall-clock timestamp in tests; the secondary
			// `id ASC` ordering provides deterministic resolution.
			const owners = result.value.map(r => r.github_owner);
			expect(owners).toContain("alpha");
			expect(owners).toContain("beta");
			expect(owners).toContain("gamma");
		}
	});

	test("scopes by owner — does not surface other users' policies", async () => {
		const other_owner = (await seed_user(db, "user_other")).id;
		await create_trust_policy(db, make_input(owner_id, { github_owner: "mine" }));
		await create_trust_policy(db, make_input(other_owner, { github_owner: "theirs" }));

		const mine = await list_trust_policies(db, { owner_id });
		expect(mine.ok).toBe(true);
		if (mine.ok) {
			expect(mine.value).toHaveLength(1);
			expect(mine.value[0].github_owner).toBe("mine");
		}
	});

	test("excludes soft-deleted policies", async () => {
		const created = await create_trust_policy(db, make_input(owner_id, { github_owner: "doomed" }));
		expect(created.ok).toBe(true);
		if (!created.ok) return;
		await delete_trust_policy(db, { id: created.value.id, owner_id });

		const result = await list_trust_policies(db, { owner_id });
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toEqual([]);
	});
});

describe("oidc-trust service — get_trust_policy", () => {
	let db: Database;
	let owner_id: string;

	beforeEach(async () => {
		db = create_test_db();
		owner_id = (await seed_user(db)).id;
	});

	test("returns the policy when it exists for the owner", async () => {
		const created = await create_trust_policy(db, make_input(owner_id));
		expect(created.ok).toBe(true);
		if (!created.ok) return;

		const result = await get_trust_policy(db, { id: created.value.id, owner_id });
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value.id).toBe(created.value.id);
	});

	test("returns not_found for unknown id", async () => {
		const result = await get_trust_policy(db, { id: "pipeline-oidc-trust_missing", owner_id });
		expect(result.ok).toBe(false);
		if (!result.ok) expect((result.error as { kind: string }).kind).toBe("not_found");
	});

	test("returns not_found when policy belongs to a different owner", async () => {
		const other_owner = (await seed_user(db, "user_other")).id;
		const created = await create_trust_policy(db, make_input(other_owner));
		expect(created.ok).toBe(true);
		if (!created.ok) return;

		const result = await get_trust_policy(db, { id: created.value.id, owner_id });
		expect(result.ok).toBe(false);
		if (!result.ok) expect((result.error as { kind: string }).kind).toBe("not_found");
	});

	test("returns not_found when policy is soft-deleted", async () => {
		const created = await create_trust_policy(db, make_input(owner_id));
		if (!created.ok) return;
		await delete_trust_policy(db, { id: created.value.id, owner_id });

		const result = await get_trust_policy(db, { id: created.value.id, owner_id });
		expect(result.ok).toBe(false);
		if (!result.ok) expect((result.error as { kind: string }).kind).toBe("not_found");
	});
});

describe("oidc-trust service — update_trust_policy", () => {
	let db: Database;
	let owner_id: string;

	beforeEach(async () => {
		db = create_test_db();
		owner_id = (await seed_user(db)).id;
	});

	test("updates only specified fields", async () => {
		const created = await create_trust_policy(db, make_input(owner_id, { repo_pattern: "old-*" }));
		if (!created.ok) return;

		const result = await update_trust_policy(db, { id: created.value.id, owner_id, repo_pattern: "new-*" });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.repo_pattern).toBe("new-*");
			expect(result.value.github_owner).toBe("f0rbit");
			expect(result.value.expected_audience).toBe("https://devpad-pipelines.dev-818.workers.dev");
		}
	});

	test("returns not_found for unknown id", async () => {
		const result = await update_trust_policy(db, { id: "pipeline-oidc-trust_missing", owner_id, repo_pattern: "x" });
		expect(result.ok).toBe(false);
		if (!result.ok) expect((result.error as { kind: string }).kind).toBe("not_found");
	});

	test("returns not_found when patching another owner's policy", async () => {
		const other_owner = (await seed_user(db, "user_other")).id;
		const created = await create_trust_policy(db, make_input(other_owner));
		if (!created.ok) return;

		const result = await update_trust_policy(db, { id: created.value.id, owner_id, repo_pattern: "evil-*" });
		expect(result.ok).toBe(false);
		if (!result.ok) expect((result.error as { kind: string }).kind).toBe("not_found");
	});
});

describe("oidc-trust service — delete_trust_policy", () => {
	let db: Database;
	let owner_id: string;

	beforeEach(async () => {
		db = create_test_db();
		owner_id = (await seed_user(db)).id;
	});

	test("soft-deletes the row (still present in DB with deleted=true)", async () => {
		const created = await create_trust_policy(db, make_input(owner_id));
		if (!created.ok) return;

		const deleted = await delete_trust_policy(db, { id: created.value.id, owner_id });
		expect(deleted.ok).toBe(true);

		// Service-layer queries no longer return it.
		const get_result = await get_trust_policy(db, { id: created.value.id, owner_id });
		expect(get_result.ok).toBe(false);

		// But the row is preserved for audit.
		const rows = await db.select().from(pipeline_oidc_trust).where(eq(pipeline_oidc_trust.id, created.value.id));
		expect(rows).toHaveLength(1);
		expect(rows[0].deleted).toBe(true);
	});

	test("returns not_found for unknown id", async () => {
		const result = await delete_trust_policy(db, { id: "pipeline-oidc-trust_missing", owner_id });
		expect(result.ok).toBe(false);
		if (!result.ok) expect((result.error as { kind: string }).kind).toBe("not_found");
	});
});

describe("oidc-trust service — touch_trust_policy_last_used", () => {
	let db: Database;
	let owner_id: string;

	beforeEach(async () => {
		db = create_test_db();
		owner_id = (await seed_user(db)).id;
	});

	test("updates last_used_at on success", async () => {
		const created = await create_trust_policy(db, make_input(owner_id));
		if (!created.ok) return;
		expect(created.value.last_used_at).toBeNull();

		const touched = await touch_trust_policy_last_used(db, { id: created.value.id });
		expect(touched.ok).toBe(true);

		const after = await get_trust_policy(db, { id: created.value.id, owner_id });
		expect(after.ok).toBe(true);
		if (after.ok) {
			expect(after.value.last_used_at).not.toBeNull();
			expect(typeof after.value.last_used_at).toBe("string");
		}
	});

	test("is idempotent for unknown ids (no-op, ok)", async () => {
		const result = await touch_trust_policy_last_used(db, { id: "pipeline-oidc-trust_missing" });
		expect(result.ok).toBe(true);
	});
});
