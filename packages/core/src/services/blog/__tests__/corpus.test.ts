import { describe, expect, test } from "bun:test";
import { create_corpus, create_memory_backend, type PostsCorpus, postsStoreDefinition } from "@devpad/schema/blog";
import { corpus } from "../corpus";

const createTestCorpus = (): PostsCorpus => create_corpus().with_backend(create_memory_backend()).with_store(postsStoreDefinition).build();

const testContent = {
	title: "Test Post",
	content: "Hello world",
	description: "A test",
	format: "md" as const,
};

describe("corpus", () => {
	describe("put", () => {
		test("saves content and returns hash", async () => {
			const c = createTestCorpus();
			const result = await corpus.put(c, "posts/user_1/post-1", testContent);
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(typeof result.value.hash).toBe("string");
				expect(result.value.hash.length).toBeGreaterThan(0);
			}
		});

		test("saves content with parent version", async () => {
			const c = createTestCorpus();
			const path = "posts/user_1/post-1";

			const first = await corpus.put(c, path, testContent);
			expect(first.ok).toBe(true);
			if (!first.ok) return;

			const updated = { ...testContent, title: "Updated" };
			const second = await corpus.put(c, path, updated, first.value.hash);
			expect(second.ok).toBe(true);
			if (second.ok) {
				expect(second.value.hash).not.toBe(first.value.hash);
			}
		});
	});

	describe("get", () => {
		test("retrieves saved content", async () => {
			const c = createTestCorpus();
			const path = "posts/user_1/post-1";

			const putResult = await corpus.put(c, path, testContent);
			expect(putResult.ok).toBe(true);
			if (!putResult.ok) return;

			const getResult = await corpus.get(c, path, putResult.value.hash);
			expect(getResult.ok).toBe(true);
			if (getResult.ok) {
				expect(getResult.value.title).toBe("Test Post");
				expect(getResult.value.content).toBe("Hello world");
				expect(getResult.value.format).toBe("md");
			}
		});

		test("returns error for nonexistent version", async () => {
			const c = createTestCorpus();
			const result = await corpus.get(c, "posts/user_1/missing", "nonexistent_hash");
			expect(result.ok).toBe(false);
		});
	});

	describe("versions", () => {
		test("lists versions for a path", async () => {
			const c = createTestCorpus();
			const path = "posts/user_1/post-1";

			const v1 = await corpus.put(c, path, testContent);
			expect(v1.ok).toBe(true);
			if (!v1.ok) return;

			const updated = { ...testContent, title: "Updated" };
			const v2 = await corpus.put(c, path, updated, v1.value.hash);
			expect(v2.ok).toBe(true);

			const result = await corpus.versions(c, path);
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.length).toBe(2);
				expect(result.value[0]!.created_at).toBeInstanceOf(Date);
			}
		});

		test("returns empty list for unused path", async () => {
			const c = createTestCorpus();
			const result = await corpus.versions(c, "posts/user_1/unused");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toEqual([]);
			}
		});
	});

	describe("delete", () => {
		test("removes all versions for a path", async () => {
			const c = createTestCorpus();
			const path = "posts/user_1/post-1";

			const putResult = await corpus.put(c, path, testContent);
			expect(putResult.ok).toBe(true);

			const deleteResult = await corpus.delete(c, path);
			expect(deleteResult.ok).toBe(true);

			const versionsResult = await corpus.versions(c, path);
			expect(versionsResult.ok).toBe(true);
			if (versionsResult.ok) {
				expect(versionsResult.value).toEqual([]);
			}
		});

		test("succeeds on path with no versions", async () => {
			const c = createTestCorpus();
			const result = await corpus.delete(c, "posts/user_1/empty");
			expect(result.ok).toBe(true);
		});
	});
});
