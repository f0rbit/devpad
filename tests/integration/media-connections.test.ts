import { describe, expect, test } from "bun:test";
import { setupIntegration } from "../shared/base-integration-test";

const t = setupIntegration();

const uniqueSlug = () => `test-profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe("media connections integration", () => {
	let profile_id = "";
	const slug = uniqueSlug();

	test("setup: create profile for connection tests", async () => {
		const result = await t.client.media.profiles.create({
			slug,
			name: "Connections Integration Profile",
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const value = result.value as any;
		profile_id = (value.profile ?? value).id;
		expect(profile_id).toBeDefined();
		expect(typeof profile_id).toBe("string");
	});

	describe("connection lifecycle", () => {
		let connection_id = "";

		test("should list connections (initially empty)", async () => {
			expect(profile_id).not.toBe("");
			const result = await t.client.media.connections.list(profile_id);
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			const value = result.value as any;
			const connections_list = Array.isArray(value) ? value : (value.accounts ?? value.connections ?? []);
			expect(Array.isArray(connections_list)).toBe(true);
			expect(connections_list.length).toBe(0);
		});

		test("should create a connection", async () => {
			expect(profile_id).not.toBe("");
			const result = await t.client.media.connections.create({
				profile_id,
				platform: "github",
				access_token: `test-token-${Date.now()}`,
				platform_user_id: "test-user-123",
				platform_username: "testuser",
			});
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			const value = result.value as any;
			connection_id = value.account_id;
			expect(connection_id).toBeDefined();
			expect(typeof connection_id).toBe("string");
			expect(value.profile_id).toBe(profile_id);
		});

		test("should list connections (has one)", async () => {
			expect(profile_id).not.toBe("");
			expect(connection_id).not.toBe("");
			const result = await t.client.media.connections.list(profile_id);
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			const value = result.value as any;
			const connections_list = Array.isArray(value) ? value : (value.accounts ?? value.connections ?? []);
			expect(connections_list.length).toBe(1);

			const conn = connections_list[0];
			expect(conn.account_id).toBe(connection_id);
			expect(conn.platform).toBe("github");
		});

		test("should update connection status (deactivate)", async () => {
			expect(connection_id).not.toBe("");
			const result = await t.client.media.connections.updateStatus(connection_id, false);
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			const value = result.value as any;
			expect(value.success).toBe(true);
			const conn = value.connection;
			expect(conn.is_active).toBe(false);
		});

		test("should update connection status (reactivate)", async () => {
			expect(connection_id).not.toBe("");
			const result = await t.client.media.connections.updateStatus(connection_id, true);
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			const value = result.value as any;
			expect(value.success).toBe(true);
			const conn = value.connection;
			expect(conn.is_active).toBe(true);
		});

		test("should get connection settings", async () => {
			expect(connection_id).not.toBe("");
			const result = await t.client.media.connections.settings.get(connection_id);
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			const value = result.value as any;
			expect(value.settings).toBeDefined();
			expect(typeof value.settings).toBe("object");
		});

		test("should update connection settings", async () => {
			expect(connection_id).not.toBe("");
			const result = await t.client.media.connections.settings.update(connection_id, {
				tracked_repos: ["owner/repo1", "owner/repo2"],
			});
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			const value = result.value as any;
			expect(value.updated).toBe(true);
		});

		test("should verify updated settings persisted", async () => {
			expect(connection_id).not.toBe("");
			const result = await t.client.media.connections.settings.get(connection_id);
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			const value = result.value as any;
			expect(value.settings.tracked_repos).toEqual(["owner/repo1", "owner/repo2"]);
		});

		test("should list connections with settings", async () => {
			expect(profile_id).not.toBe("");
			const result = await t.client.media.connections.list(profile_id, { include_settings: true });
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			const value = result.value as any;
			const connections_list = Array.isArray(value) ? value : (value.accounts ?? value.connections ?? []);
			expect(connections_list.length).toBe(1);
		});

		test("should delete a connection", async () => {
			expect(connection_id).not.toBe("");
			const result = await t.client.media.connections.delete(connection_id);
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			const value = result.value as any;
			expect(value.deleted).toBe(true);
			expect(value.account_id).toBe(connection_id);
		});

		test("should list connections (empty again)", async () => {
			expect(profile_id).not.toBe("");
			const result = await t.client.media.connections.list(profile_id);
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			const value = result.value as any;
			const connections_list = Array.isArray(value) ? value : (value.accounts ?? value.connections ?? []);
			expect(connections_list.length).toBe(0);
		});
	});

	describe("connection error cases", () => {
		test("should fail to create connection with invalid platform", async () => {
			expect(profile_id).not.toBe("");
			const result = await t.client.media.connections.create({
				profile_id,
				platform: "invalid-platform",
				access_token: "test-token",
			});
			expect(result.ok).toBe(false);
		});

		test("should fail to create connection without access_token", async () => {
			expect(profile_id).not.toBe("");
			const result = await t.client.media.connections.create({
				profile_id,
				platform: "github",
				access_token: "",
			});
			expect(result.ok).toBe(false);
		});

		test("should return error for non-existent connection delete", async () => {
			const result = await t.client.media.connections.delete("non-existent-account-id");
			expect(result.ok).toBe(false);
		});

		test("should return error for non-existent connection refresh", async () => {
			const result = await t.client.media.connections.refresh("non-existent-account-id");
			expect(result.ok).toBe(false);
		});

		test("should return error for non-existent connection status update", async () => {
			const result = await t.client.media.connections.updateStatus("non-existent-account-id", false);
			expect(result.ok).toBe(false);
		});
	});

	describe("refresh all", () => {
		test("should handle refresh-all without crashing", async () => {
			const result = await t.client.media.connections.refreshAll();
			expect(typeof result.ok).toBe("boolean");
		});
	});

	describe("repos and subreddits", () => {
		test("should handle repos request for non-existent account", async () => {
			const result = await t.client.media.connections.repos("non-existent-account-id");
			expect(typeof result.ok).toBe("boolean");
		});

		test("should handle subreddits request for non-existent account", async () => {
			const result = await t.client.media.connections.subreddits("non-existent-account-id");
			expect(typeof result.ok).toBe("boolean");
		});
	});

	test("cleanup: delete test profile", async () => {
		if (profile_id) {
			const result = await t.client.media.profiles.delete(profile_id);
			expect(result.ok).toBe(true);
		}
	});
});
