import { describe, expect, test } from "bun:test";
import { setupIntegration } from "../shared/base-integration-test";

const t = setupIntegration();

const uniqueSlug = () => `test-post-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe("blog API client integration", () => {
	test("should verify blog client namespace exists", () => {
		expect(t.client.blog).toBeDefined();
		expect(t.client.blog.posts).toBeDefined();
		expect(t.client.blog.tags).toBeDefined();
		expect(t.client.blog.categories).toBeDefined();
		expect(t.client.blog.tokens).toBeDefined();
	});

	test("should list blog posts (empty)", async () => {
		const result = await t.client.blog.posts.list();
		expect(result.ok).toBe(true);
	});

	test("should get blog category tree", async () => {
		const result = await t.client.blog.categories.tree();
		expect(result.ok).toBe(true);
	});

	test("should list blog tags (empty)", async () => {
		const result = await t.client.blog.tags.list();
		expect(result.ok).toBe(true);
	});

	test("should list blog tokens", async () => {
		const result = await t.client.blog.tokens.list();
		expect(result.ok).toBe(true);
	});

	test("should create a blog post", async () => {
		const result = await t.client.blog.posts.create({
			slug: uniqueSlug(),
			title: "Test Post",
			content: "# Hello",
			format: "md",
			category: "root",
			tags: [],
		});
		expect(result.ok).toBe(true);
	});

	test("should create a blog token", async () => {
		const result = await t.client.blog.tokens.create({
			name: `test-token-${Date.now()}`,
			note: "Integration test",
		});
		expect(result.ok).toBe(true);
	});

	describe("posts CRUD lifecycle", () => {
		let post_uuid = "";
		const slug = uniqueSlug();

		test("should create a post", async () => {
			const result = await t.client.blog.posts.create({
				slug,
				title: "CRUD Test Post",
				content: "# CRUD Test\nThis is a test post for CRUD operations.",
				format: "md",
				category: "root",
				tags: [],
			});
			expect(result.ok).toBe(true);
			if (result.ok) {
				post_uuid = result.value.uuid;
				expect(result.value.title).toBe("CRUD Test Post");
				expect(result.value.slug).toBe(slug);
			}
		});

		test("should get post by slug", async () => {
			const result = await t.client.blog.posts.getBySlug(slug);
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.uuid).toBe(post_uuid);
				expect(result.value.slug).toBe(slug);
				expect(result.value.title).toBe("CRUD Test Post");
			}
		});

		test("should list posts", async () => {
			const result = await t.client.blog.posts.list();
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.posts.length).toBeGreaterThanOrEqual(1);
				const found = result.value.posts.find(p => p.uuid === post_uuid);
				expect(found).toBeDefined();
			}
		});

		test("should list posts with filters", async () => {
			const result = await t.client.blog.posts.list({ limit: 1, offset: 0 });
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.posts.length).toBeLessThanOrEqual(1);
			}
		});

		test("should update a post", async () => {
			const result = await t.client.blog.posts.update(post_uuid, {
				title: "Updated CRUD Test Post",
			});
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.title).toBe("Updated CRUD Test Post");
				expect(result.value.uuid).toBe(post_uuid);
			}
		});

		test("should delete a post", async () => {
			const result = await t.client.blog.posts.delete(post_uuid);
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.success).toBe(true);
			}
		});

		test("should return error for deleted post slug", async () => {
			const result = await t.client.blog.posts.getBySlug(slug);
			expect(result.ok).toBe(false);
		});
	});

	describe("categories", () => {
		test("should get category tree", async () => {
			const result = await t.client.blog.categories.tree();
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.categories).toBeDefined();
				expect(Array.isArray(result.value.categories)).toBe(true);
			}
		});

		test("should create a category", async () => {
			const result = await t.client.blog.categories.create({ name: "test-cat" });
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.name).toBe("test-cat");
			}
		});

		test("should update a category", async () => {
			const result = await t.client.blog.categories.update("test-cat", { name: "renamed-cat" });
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.name).toBe("renamed-cat");
			}
		});

		test("should delete a category", async () => {
			const result = await t.client.blog.categories.delete("renamed-cat");
			expect(result.ok).toBe(true);
		});
	});

	describe("blog tags", () => {
		let tag_post_uuid = "";
		const tag_slug = uniqueSlug();

		test("should create a post for tag operations", async () => {
			const result = await t.client.blog.posts.create({
				slug: tag_slug,
				title: "Tag Test Post",
				content: "# Tags\nPost for testing tag operations.",
				format: "md",
				category: "root",
				tags: [],
			});
			expect(result.ok).toBe(true);
			if (result.ok) {
				tag_post_uuid = result.value.uuid;
			}
		});

		test("should add tags to a post", async () => {
			const result = await t.client.blog.tags.addToPost(tag_post_uuid, ["tag1", "tag2"]);
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.tags).toContain("tag1");
				expect(result.value.tags).toContain("tag2");
			}
		});

		test("should get tags for a post", async () => {
			const result = await t.client.blog.tags.getForPost(tag_post_uuid);
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.tags).toContain("tag1");
				expect(result.value.tags).toContain("tag2");
			}
		});

		test("should set tags for a post (replace all)", async () => {
			const result = await t.client.blog.tags.setForPost(tag_post_uuid, ["tag3"]);
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.tags).toContain("tag3");
				expect(result.value.tags).not.toContain("tag1");
				expect(result.value.tags).not.toContain("tag2");
			}
		});

		test("should remove a tag from a post", async () => {
			const result = await t.client.blog.tags.removeFromPost(tag_post_uuid, "tag3");
			expect(result.ok).toBe(true);
		});

		test("should list tags", async () => {
			const result = await t.client.blog.tags.list();
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.tags).toBeDefined();
				expect(Array.isArray(result.value.tags)).toBe(true);
			}
		});

		test("cleanup: delete tag test post", async () => {
			const result = await t.client.blog.posts.delete(tag_post_uuid);
			expect(result.ok).toBe(true);
		});
	});

	describe("tokens", () => {
		let created_token_id = "";

		test("should list tokens", async () => {
			const result = await t.client.blog.tokens.list();
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.tokens).toBeDefined();
				expect(Array.isArray(result.value.tokens)).toBe(true);
			}
		});

		test("should create a token", async () => {
			const result = await t.client.blog.tokens.create({
				name: `test-token-crud-${Date.now()}`,
				note: "Integration test token",
			});
			expect(result.ok).toBe(true);
			if (result.ok) {
				created_token_id = result.value.id;
				expect(result.value.name).toContain("test-token-crud");
				expect(result.value.token).toBeDefined();
			}
		});

		test("cleanup: delete created token", async () => {
			if (!created_token_id) return;
			const result = await t.client.blog.tokens.delete(created_token_id);
			expect(result.ok).toBe(true);
		});
	});
});
