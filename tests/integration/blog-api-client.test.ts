import { describe, expect, test } from "bun:test";
import { BaseIntegrationTest, setupBaseIntegrationTest } from "../shared/base-integration-test";

class BlogIntegrationTest extends BaseIntegrationTest {}

const testInstance = new BlogIntegrationTest();
setupBaseIntegrationTest(testInstance);

const SKIP_REASON = "not yet implemented (Phase 3)";

const uniqueSlug = () => `test-post-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe("blog API client integration", () => {
	test("should verify blog client namespace exists", () => {
		expect(testInstance.client.blog).toBeDefined();
		expect(testInstance.client.blog.posts).toBeDefined();
		expect(testInstance.client.blog.tags).toBeDefined();
		expect(testInstance.client.blog.categories).toBeDefined();
		expect(testInstance.client.blog.tokens).toBeDefined();
	});

	test("should list blog posts (empty)", async () => {
		const result = await testInstance.client.blog.posts.list();
		expect(result.ok).toBe(true);
	});

	test("should get blog category tree", async () => {
		const result = await testInstance.client.blog.categories.tree();
		expect(result.ok).toBe(true);
	});

	test("should list blog tags (empty)", async () => {
		const result = await testInstance.client.blog.tags.list();
		expect(result.ok).toBe(true);
	});

	test("should list blog tokens", async () => {
		const result = await testInstance.client.blog.tokens.list();
		expect(result.ok).toBe(true);
	});

	test("should create a blog post", async () => {
		const result = await testInstance.client.blog.posts.create({
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
		const result = await testInstance.client.blog.tokens.create({
			name: `test-token-${Date.now()}`,
			note: "Integration test",
		});
		expect(result.ok).toBe(true);
	});

	describe("posts CRUD lifecycle", () => {
		test.skip(`should create a post - ${SKIP_REASON}`, () => {});
		test.skip(`should get post by slug - ${SKIP_REASON}`, () => {});
		test.skip(`should list posts - ${SKIP_REASON}`, () => {});
		test.skip(`should list posts with filters - ${SKIP_REASON}`, () => {});
		test.skip(`should update a post - ${SKIP_REASON}`, () => {});
		test.skip(`should delete a post - ${SKIP_REASON}`, () => {});
		test.skip(`should return error for deleted post slug - ${SKIP_REASON}`, () => {});
	});

	describe("categories", () => {
		test.skip(`should get category tree - ${SKIP_REASON}`, () => {});
		test.skip(`should create a category - ${SKIP_REASON}`, () => {});
		test.skip(`should update a category - ${SKIP_REASON}`, () => {});
		test.skip(`should delete a category - ${SKIP_REASON}`, () => {});
	});

	describe("blog tags", () => {
		test.skip(`should list tags - ${SKIP_REASON}`, () => {});
		test.skip(`should create a post for tag operations - ${SKIP_REASON}`, () => {});
		test.skip(`should add tags to a post - ${SKIP_REASON}`, () => {});
		test.skip(`should get tags for a post - ${SKIP_REASON}`, () => {});
		test.skip(`should set tags for a post (replace all) - ${SKIP_REASON}`, () => {});
		test.skip(`should remove a tag from a post - ${SKIP_REASON}`, () => {});
		test.skip(`cleanup: delete tag test post - ${SKIP_REASON}`, () => {});
	});

	describe("tokens", () => {
		test.skip(`should list tokens - ${SKIP_REASON}`, () => {});
		test.skip(`should create a token - ${SKIP_REASON}`, () => {});
		test.skip(`cleanup: delete created token - ${SKIP_REASON}`, () => {});
	});
});
