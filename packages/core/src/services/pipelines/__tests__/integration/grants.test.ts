import { describe, expect, test } from "bun:test";
import type { PipelineGrant } from "@devpad/schema";
import { approve_grant, check_grant, list_grants, request_grant } from "../../grants.js";

const build_mock_grant = (overrides: Partial<PipelineGrant> = {}): PipelineGrant => ({
	id: "pipeline-grant_123",
	package_id: "pipeline-package_pkg",
	stage_name: "staging",
	scope: "anthropic:messages",
	granted_by: "user_123",
	granted_at: "2024-01-01T00:00:00Z",
	created_at: "2024-01-01T00:00:00Z",
	updated_at: "2024-01-01T00:00:00Z",
	created_by: "user",
	modified_by: "user",
	protected: false,
	deleted: false,
	...overrides,
});

function create_mock_db(responses: {
	list?: PipelineGrant[];
	insert?: PipelineGrant[];
	update?: PipelineGrant[];
} = {}) {
	const chain: any = {
		select: () => chain,
		from: () => chain,
		where: () => chain,
		insert: () => chain,
		values: () => chain,
		returning: () => responses.insert ?? responses.update ?? [],
		update: () => chain,
		set: () => chain,
		delete: () => chain,
	};

	return {
		...chain,
		select: () => ({
			...chain,
			from: () => ({
				...chain,
				where: () => responses.list ?? [],
			}),
		}),
		insert: () => ({
			...chain,
			values: () => ({
				...chain,
				returning: () => responses.insert ?? [],
			}),
		}),
		update: () => ({
			...chain,
			set: () => ({
				...chain,
				where: () => ({
					...chain,
					returning: () => responses.update ?? [],
				}),
			}),
		}),
	} as any;
}

describe("grants service", () => {
	describe("list_grants", () => {
		test("returns list of grants for a package", async () => {
			const grants = [
				build_mock_grant({ id: "grant_1" }),
				build_mock_grant({ id: "grant_2", scope: "github:read:my-org/*" }),
			];
			const db = create_mock_db({ list: grants });

			const result = await list_grants(db, "pipeline-package_pkg");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toHaveLength(2);
				expect(result.value[0].id).toBe("grant_1");
				expect(result.value[1].id).toBe("grant_2");
			}
		});

		test("returns empty list when no grants exist", async () => {
			const db = create_mock_db({ list: [] });

			const result = await list_grants(db, "pipeline-package_pkg");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toHaveLength(0);
			}
		});
	});

	describe("check_grant", () => {
		test("returns true when grant exists and is approved", async () => {
			const grants = [
				build_mock_grant({
					scope: "anthropic:messages",
					stage_name: "staging",
					granted_at: "2024-01-01T00:00:00Z",
				}),
			];
			const db = create_mock_db({ list: grants });

			const result = await check_grant(
				db,
				"pipeline-package_pkg",
				"staging",
				"anthropic:messages"
			);
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toBe(true);
			}
		});

		test("returns false when no matching grant exists", async () => {
			const grants = [
				build_mock_grant({
					scope: "github:read:my-org/*",
					stage_name: "staging",
					granted_at: "2024-01-01T00:00:00Z",
				}),
			];
			const db = create_mock_db({ list: grants });

			const result = await check_grant(
				db,
				"pipeline-package_pkg",
				"staging",
				"anthropic:messages"
			);
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toBe(false);
			}
		});

		test("returns false when grant exists but is not approved", async () => {
			const grants = [
				build_mock_grant({
					scope: "anthropic:messages",
					stage_name: "staging",
					granted_at: null,
				}),
			];
			const db = create_mock_db({ list: grants });

			const result = await check_grant(
				db,
				"pipeline-package_pkg",
				"staging",
				"anthropic:messages"
			);
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toBe(false);
			}
		});

		test("returns true when wildcard grant matches scope", async () => {
			const grants = [
				build_mock_grant({
					scope: "github:read:my-org/*",
					stage_name: "staging",
					granted_at: "2024-01-01T00:00:00Z",
				}),
			];
			const db = create_mock_db({ list: grants });

			const result = await check_grant(
				db,
				"pipeline-package_pkg",
				"staging",
				"github:read:my-org/repo-x"
			);
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toBe(true);
			}
		});
	});

	describe("request_grant", () => {
		test("auto-approves anthropic:messages at staging", async () => {
			const inserted = [
				build_mock_grant({
					scope: "anthropic:messages",
					stage_name: "staging",
					granted_at: "2024-01-01T00:00:00Z",
				}),
			];
			const db = create_mock_db({ insert: inserted });

			const result = await request_grant(
				db,
				"pipeline-package_pkg",
				"staging",
				"anthropic:messages"
			);
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.granted_at).not.toBeNull();
			}
		});

		test("leaves grant pending for non-auto-approvable scope", async () => {
			const inserted = [
				build_mock_grant({
					scope: "github:read:my-org/*",
					stage_name: "staging",
					granted_at: null,
				}),
			];
			const db = create_mock_db({ insert: inserted });

			const result = await request_grant(
				db,
				"pipeline-package_pkg",
				"staging",
				"github:read:my-org/*"
			);
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.granted_at).toBeNull();
			}
		});

		test("returns error if insert fails", async () => {
			const db = create_mock_db({ insert: [] });

			const result = await request_grant(
				db,
				"pipeline-package_pkg",
				"staging",
				"anthropic:messages"
			);
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("store_error");
			}
		});
	});

	describe("approve_grant", () => {
		test("approves a pending grant", async () => {
			const updated = [
				build_mock_grant({
					id: "pipeline-grant_123",
					granted_at: "2024-01-02T00:00:00Z",
					granted_by: "user_approver",
				}),
			];
			const db = create_mock_db({ update: updated });

			const result = await approve_grant(db, "pipeline-grant_123", "user_approver");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.granted_at).not.toBeNull();
				expect(result.value.granted_by).toBe("user_approver");
			}
		});

		test("returns not_found if grant does not exist", async () => {
			const db = create_mock_db({ update: [] });

			const result = await approve_grant(db, "pipeline-grant_missing", "user_approver");
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("not_found");
				if (result.error.kind === "not_found") {
					expect(result.error.resource).toBe("grant");
				}
			}
		});
	});
});
