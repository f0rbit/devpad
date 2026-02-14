import { describe, expect, test } from "bun:test";
import { setupIntegration } from "../shared/base-integration-test";

const t = setupIntegration();

const uniqueSlug = () => `test-version-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe("blog post versions integration", () => {
	describe("version lifecycle", () => {
		let post_uuid = "";
		let version_hashes: string[] = [];
		const slug = uniqueSlug();

		test("should create a post (creates first version)", async () => {
			const result = await t.client.blog.posts.create({
				slug,
				title: "Version 1",
				content: "# V1",
				format: "md",
				category: "root",
				tags: [],
			});
			expect(result.ok).toBe(true);
			if (result.ok) {
				post_uuid = result.value.uuid;
				expect(result.value.title).toBe("Version 1");
			}
		});

		test("should update post (creates second version)", async () => {
			const result = await t.client.blog.posts.update(post_uuid, {
				title: "Version 2",
				content: "# V2",
			});
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.title).toBe("Version 2");
			}
		});

		test("should list versions (expect at least 2)", async () => {
			const result = await t.client.blog.posts.versions(post_uuid);
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.versions.length).toBeGreaterThanOrEqual(2);
				for (const version of result.value.versions) {
					expect(version.hash).toBeDefined();
					expect(typeof version.hash).toBe("string");
					expect(version.created_at).toBeDefined();
				}
				version_hashes = result.value.versions.map(v => v.hash);
			}
		});

		test("should get a specific version by hash", async () => {
			expect(version_hashes.length).toBeGreaterThanOrEqual(1);
			const hash = version_hashes[0];
			const result = await t.client.blog.posts.version(post_uuid, hash);
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toBeDefined();
				expect(result.value.title).toBeDefined();
			}
		});

		test("should restore an older version", async () => {
			expect(version_hashes.length).toBeGreaterThanOrEqual(2);
			const older_hash = version_hashes[version_hashes.length - 1];
			const result = await t.client.blog.posts.restore(post_uuid, older_hash);
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.title).toBe("Version 1");
			}
		});

		test("should show restored content when fetched by slug", async () => {
			const result = await t.client.blog.posts.getBySlug(slug);
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.title).toBe("Version 1");
			}
		});

		test("cleanup: delete test post", async () => {
			const result = await t.client.blog.posts.delete(post_uuid);
			expect(result.ok).toBe(true);
		});
	});

	describe("version error cases", () => {
		test("should fail to list versions for non-existent post", async () => {
			const result = await t.client.blog.posts.versions("00000000-0000-0000-0000-000000000000");
			expect(result.ok).toBe(false);
		});

		test("should fail to get version with invalid hash", async () => {
			let post_uuid = "";
			const slug = uniqueSlug();

			const create_result = await t.client.blog.posts.create({
				slug,
				title: "Hash Error Test",
				content: "# Test",
				format: "md",
				category: "root",
				tags: [],
			});
			expect(create_result.ok).toBe(true);
			if (create_result.ok) {
				post_uuid = create_result.value.uuid;
			}

			const result = await t.client.blog.posts.version(post_uuid, "invalid-hash-that-does-not-exist");
			expect(result.ok).toBe(false);

			await t.client.blog.posts.delete(post_uuid);
		});
	});
});
