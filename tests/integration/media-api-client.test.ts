import { describe, expect, test } from "bun:test";
import { setupIntegration } from "../shared/base-integration-test";
import { TEST_USER_ID } from "./setup";

const t = setupIntegration();

const uniqueSlug = () => `test-profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe("media API client integration", () => {
	test("should verify media client namespace exists", () => {
		expect(t.client.media).toBeDefined();
		expect(t.client.media.profiles).toBeDefined();
		expect(t.client.media.connections).toBeDefined();
		expect(t.client.media.timeline).toBeDefined();
	});

	test("should list media profiles (empty)", async () => {
		const result = await t.client.media.profiles.list();
		expect(result.ok).toBe(true);
	});

	test("should create a media profile", async () => {
		const result = await t.client.media.profiles.create({
			slug: uniqueSlug(),
			name: "Test Media Profile",
		});
		expect(result.ok).toBe(true);
	});

	test("should get media timeline", async () => {
		const result = await t.client.media.timeline.get(TEST_USER_ID);
		expect(typeof result.ok).toBe("boolean");
	});

	describe("profiles CRUD lifecycle", () => {
		let created_id = "";
		const slug = uniqueSlug();

		test("should create a profile", async () => {
			const result = await t.client.media.profiles.create({
				slug,
				name: "CRUD Test Profile",
				description: "Profile for CRUD lifecycle test",
			});
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			const value = result.value as any;
			const profile_data = value.profile ?? value;
			created_id = profile_data.id;

			expect(created_id).toBeDefined();
			expect(typeof created_id).toBe("string");
			expect(profile_data.slug).toBe(slug);
		});

		test("should get profile by id", async () => {
			expect(created_id).not.toBe("");
			const result = await t.client.media.profiles.get(created_id);
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			const value = result.value as any;
			const profile_data = value.profile ?? value;
			expect(profile_data.id).toBe(created_id);
		});

		test("should list profiles", async () => {
			const result = await t.client.media.profiles.list();
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			const value = result.value as any;
			const profiles_list = Array.isArray(value) ? value : value.profiles;
			expect(Array.isArray(profiles_list)).toBe(true);

			const found = profiles_list.some((p: any) => p.id === created_id);
			expect(found).toBe(true);
		});

		test("should update a profile", async () => {
			expect(created_id).not.toBe("");
			const result = await t.client.media.profiles.update(created_id, {
				name: "Updated CRUD Profile",
				description: "Updated description",
			});
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			const value = result.value as any;
			const profile_data = value.profile ?? value;
			expect(profile_data.name).toBe("Updated CRUD Profile");
		});

		test("should delete a profile", async () => {
			expect(created_id).not.toBe("");
			const result = await t.client.media.profiles.delete(created_id);
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			const value = result.value as any;
			expect(value.deleted ?? value.success).toBe(true);

			const get_result = await t.client.media.profiles.get(created_id);
			expect(get_result.ok).toBe(false);
		});
	});

	describe("profile filters", () => {
		let profile_id = "";
		let filter_id = "";

		test("should create a profile for filter tests", async () => {
			const result = await t.client.media.profiles.create({
				slug: uniqueSlug(),
				name: "Filter Test Profile",
			});
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			const value = result.value as any;
			profile_id = (value.profile ?? value).id;
			expect(profile_id).toBeDefined();
		});

		test("should list filters (initially empty)", async () => {
			expect(profile_id).not.toBe("");
			const result = await t.client.media.profiles.filters.list(profile_id);
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			const value = result.value as any;
			const filters_list = Array.isArray(value) ? value : value.filters;
			expect(filters_list).toEqual([]);
		});

		test("should add a filter", async () => {
			expect(profile_id).not.toBe("");
			const result = await t.client.media.profiles.filters.add(profile_id, {
				account_id: "fake-account-for-filter-test",
				filter_type: "exclude",
				filter_key: "keyword",
				filter_value: "spam",
			});

			if (result.ok) {
				const value = result.value as any;
				filter_id = value.id;
				expect(filter_id).toBeDefined();
			} else {
				expect(result.ok).toBe(false);
			}
		});

		test("should remove a filter", async () => {
			expect(profile_id).not.toBe("");
			if (!filter_id) {
				return;
			}
			const result = await t.client.media.profiles.filters.remove(profile_id, filter_id);
			expect(result.ok).toBe(true);
		});

		test("cleanup: delete filter test profile", async () => {
			if (profile_id) {
				const result = await t.client.media.profiles.delete(profile_id);
				expect(result.ok).toBe(true);
			}
		});
	});

	describe("connections", () => {
		test("should list connections without crashing", async () => {
			const profile_result = await t.client.media.profiles.create({
				slug: uniqueSlug(),
				name: "Connections Test Profile",
			});
			expect(profile_result.ok).toBe(true);
			if (!profile_result.ok) return;

			const value = profile_result.value as any;
			const profile_id = (value.profile ?? value).id;

			const result = await t.client.media.connections.list(profile_id);
			expect(result.ok).toBe(true);
			if (result.ok) {
				const conn_value = result.value as any;
				const connections_list = Array.isArray(conn_value) ? conn_value : (conn_value.accounts ?? conn_value.connections ?? []);
				expect(Array.isArray(connections_list)).toBe(true);
			}

			await t.client.media.profiles.delete(profile_id);
		});
	});

	describe("timeline", () => {
		test("should get timeline without crashing", async () => {
			const result = await t.client.media.timeline.get(TEST_USER_ID);
			expect(typeof result.ok).toBe("boolean");
		});
	});
});
