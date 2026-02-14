import { describe, expect, test } from "bun:test";
import { setupIntegration } from "../shared/base-integration-test";
import { TEST_USER_ID } from "./setup";

const t = setupIntegration();

const uniqueSlug = () => `test-timeline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe("media timeline integration", () => {
	describe("profile timeline", () => {
		let profile_id = "";
		let profile_slug = "";

		test("setup: create a profile", async () => {
			profile_slug = uniqueSlug();
			const result = await t.client.media.profiles.create({
				slug: profile_slug,
				name: "Timeline Test Profile",
			});
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			const value = result.value as any;
			profile_id = (value.profile ?? value).id;
			expect(profile_id).toBeDefined();
			expect(typeof profile_id).toBe("string");
		});

		test("should get timeline for profile (empty)", async () => {
			expect(profile_slug).not.toBe("");
			const result = await t.client.media.profiles.timeline(profile_slug);
			expect(typeof result.ok).toBe("boolean");

			if (result.ok) {
				const value = result.value as any;
				expect(value).toBeDefined();
				if (value.groups) {
					expect(Array.isArray(value.groups)).toBe(true);
				}
			}
		});

		test("should get timeline with limit parameter", async () => {
			expect(profile_slug).not.toBe("");
			const result = await t.client.media.profiles.timeline(profile_slug, { limit: 10 });
			expect(typeof result.ok).toBe("boolean");

			if (result.ok) {
				const value = result.value as any;
				expect(value).toBeDefined();
				if (value.groups) {
					expect(Array.isArray(value.groups)).toBe(true);
					expect(value.groups.length).toBeLessThanOrEqual(10);
				}
			}
		});

		test("should get timeline with before parameter", async () => {
			expect(profile_slug).not.toBe("");
			const before = new Date().toISOString();
			const result = await t.client.media.profiles.timeline(profile_slug, { before });
			expect(typeof result.ok).toBe("boolean");
		});

		test("should get timeline with both limit and before", async () => {
			expect(profile_slug).not.toBe("");
			const before = new Date().toISOString();
			const result = await t.client.media.profiles.timeline(profile_slug, { limit: 5, before });
			expect(typeof result.ok).toBe("boolean");
		});

		test("should handle timeline for non-existent profile slug", async () => {
			const result = await t.client.media.profiles.timeline("non-existent-slug-xyz-999");
			expect(typeof result.ok).toBe("boolean");
			expect(result.ok).toBe(false);
		});

		test("cleanup: delete test profile", async () => {
			if (!profile_id) return;
			const result = await t.client.media.profiles.delete(profile_id);
			expect(result.ok).toBe(true);
		});
	});

	describe("user timeline", () => {
		test("should get user timeline without crashing", async () => {
			const result = await t.client.media.timeline.get(TEST_USER_ID);
			expect(typeof result.ok).toBe("boolean");

			if (result.ok) {
				const value = result.value as any;
				expect(value).toBeDefined();
				if (value.user_id) {
					expect(value.user_id).toBe(TEST_USER_ID);
				}
				if (value.groups) {
					expect(Array.isArray(value.groups)).toBe(true);
				}
			}
		});

		test("should get user timeline with date range", async () => {
			const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
			const to = new Date().toISOString();
			const result = await t.client.media.timeline.get(TEST_USER_ID, { from, to });
			expect(typeof result.ok).toBe("boolean");
		});

		test("should handle getRaw for non-existent data", async () => {
			const result = await t.client.media.timeline.getRaw(TEST_USER_ID, "github", "fake-account-id");
			expect(typeof result.ok).toBe("boolean");
			expect(result.ok).toBe(false);
		});

		test("should handle getRaw for unknown platform", async () => {
			const result = await t.client.media.timeline.getRaw(TEST_USER_ID, "nonexistent-platform", "fake-account");
			expect(typeof result.ok).toBe("boolean");
			expect(result.ok).toBe(false);
		});
	});
});
