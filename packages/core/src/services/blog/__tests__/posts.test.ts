import { describe, expect, test } from "bun:test";
import { create_corpus, create_memory_backend, type PostsCorpus, postsStoreDefinition } from "@devpad/schema/blog";
import { createPostService } from "../posts";

const mockPostRow = (overrides: Partial<Record<string, any>> = {}) => ({
	id: 1,
	uuid: "post-uuid-1",
	author_id: "user_1",
	slug: "test-post",
	corpus_version: "v1hash",
	category: "root",
	archived: false,
	publish_at: null,
	created_at: new Date("2024-01-01"),
	updated_at: new Date("2024-01-01"),
	...overrides,
});

const mockContent = {
	title: "Test Post",
	content: "Hello world",
	description: "A test post",
	format: "md" as const,
};

const createTestCorpus = (): PostsCorpus => create_corpus().with_backend(create_memory_backend()).with_store(postsStoreDefinition).build();

function createMockDb(opts: { selectResults?: any[][]; returning?: any[] } = {}) {
	let selectCallIndex = 0;
	const selectResults = opts.selectResults ?? [[]];

	const makeChain = (): any => {
		const chain: any = {
			from: () => chain,
			where: () => chain,
			orderBy: () => chain,
			limit: () => chain,
			offset: () => chain,
			leftJoin: () => chain,
			innerJoin: () => chain,
			groupBy: () => chain,
			set: () => chain,
			values: () => ({
				...chain,
				returning: () => Promise.resolve(opts.returning ?? []),
			}),
			returning: () => Promise.resolve(opts.returning ?? []),
			then: (resolve: Function) => {
				const idx = selectCallIndex++;
				resolve(selectResults[idx] ?? []);
			},
		};
		return chain;
	};

	return {
		select: (...args: any[]) => makeChain(),
		insert: () => {
			const chain = makeChain();
			return {
				...chain,
				values: (...args: any[]) => ({
					...chain,
					returning: () => Promise.resolve(opts.returning ?? []),
				}),
			};
		},
		update: () => {
			const chain = makeChain();
			return {
				...chain,
				set: () => ({
					...chain,
					where: () => ({
						...chain,
						returning: () => Promise.resolve(opts.returning ?? []),
					}),
				}),
			};
		},
		delete: () => makeChain(),
	} as any;
}

describe("createPostService", () => {
	describe("getBySlug", () => {
		test("returns not_found when slug does not exist", async () => {
			const db = createMockDb({ selectResults: [[]] });
			const corpus = createTestCorpus();
			const service = createPostService({ db, corpus });

			const result = await service.getBySlug("user_1", "nonexistent");
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("not_found");
			}
		});
	});

	describe("getByUuid", () => {
		test("returns not_found when uuid does not exist", async () => {
			const db = createMockDb({ selectResults: [[]] });
			const corpus = createTestCorpus();
			const service = createPostService({ db, corpus });

			const result = await service.getByUuid("user_1", "missing-uuid");
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("not_found");
			}
		});

		test("returns not_found when post has no corpus_version", async () => {
			const row = mockPostRow({ corpus_version: null });
			const db = createMockDb({ selectResults: [[row]] });
			const corpus = createTestCorpus();
			const service = createPostService({ db, corpus });

			const result = await service.getByUuid("user_1", "post-uuid-1");
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("not_found");
			}
		});
	});

	describe("create", () => {
		test("creates post with corpus content", async () => {
			const row = mockPostRow();
			const db = createMockDb({
				selectResults: [[]],
				returning: [row],
			});
			const corpus = createTestCorpus();
			const service = createPostService({ db, corpus });

			const result = await service.create("user_1", {
				slug: "new-post",
				title: "New Post",
				content: "Content here",
				format: "md",
			});
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.title).toBe("New Post");
				expect(result.value.uuid).toBe("post-uuid-1");
			}
		});

		test("returns slug_conflict when slug already exists", async () => {
			const existing = [{ id: 99 }];
			const db = createMockDb({ selectResults: [existing] });
			const corpus = createTestCorpus();
			const service = createPostService({ db, corpus });

			const result = await service.create("user_1", {
				slug: "existing-slug",
				title: "New Post",
				content: "Content",
				format: "md",
			});
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("slug_conflict");
			}
		});

		test("creates post with tags and category", async () => {
			const row = mockPostRow({ category: "tech" });
			const db = createMockDb({
				selectResults: [[]],
				returning: [row],
			});
			const corpus = createTestCorpus();
			const service = createPostService({ db, corpus });

			const result = await service.create("user_1", {
				slug: "tagged-post",
				title: "Tagged Post",
				content: "Content",
				format: "md",
				category: "tech",
				tags: ["javascript", "web"],
			});
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.tags).toEqual(["javascript", "web"]);
			}
		});
	});

	describe("delete", () => {
		test("returns not_found when post does not exist", async () => {
			const db = createMockDb({ selectResults: [[]] });
			const corpus = createTestCorpus();
			const service = createPostService({ db, corpus });

			const result = await service.delete("user_1", "missing-uuid");
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("not_found");
			}
		});

		test("deletes post and corpus content", async () => {
			const row = mockPostRow();
			const corpus = createTestCorpus();

			const { corpus: corpusHelper } = await import("../corpus");
			const path = `posts/user_1/${row.uuid}`;
			await corpusHelper.put(corpus, path, mockContent);

			const db = createMockDb({ selectResults: [[row]] });
			const service = createPostService({ db, corpus });

			const result = await service.delete("user_1", "post-uuid-1");
			expect(result.ok).toBe(true);
		});
	});

	describe("update", () => {
		test("returns not_found when post does not exist", async () => {
			const db = createMockDb({ selectResults: [[]] });
			const corpus = createTestCorpus();
			const service = createPostService({ db, corpus });

			const result = await service.update("user_1", "missing-uuid", { title: "Updated" });
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("not_found");
			}
		});

		test("returns not_found when post has no corpus_version", async () => {
			const row = mockPostRow({ corpus_version: null });
			const db = createMockDb({ selectResults: [[row]] });
			const corpus = createTestCorpus();
			const service = createPostService({ db, corpus });

			const result = await service.update("user_1", "post-uuid-1", { title: "Updated" });
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("not_found");
			}
		});

		test("returns slug_conflict when changing to existing slug", async () => {
			const row = mockPostRow();
			const corpus = createTestCorpus();
			const path = `posts/user_1/${row.uuid}`;
			const { corpus: corpusHelper } = await import("../corpus");
			const putResult = await corpusHelper.put(corpus, path, mockContent);
			if (!putResult.ok) throw new Error("Setup failed");

			const rowWithVersion = mockPostRow({ corpus_version: putResult.value.hash });
			const conflicting = [{ id: 99 }];
			const db = createMockDb({
				selectResults: [[rowWithVersion], conflicting],
			});
			const service = createPostService({ db, corpus });

			const result = await service.update("user_1", "post-uuid-1", { slug: "taken-slug" });
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("slug_conflict");
			}
		});

		test("updates metadata-only fields without content change", async () => {
			const corpus = createTestCorpus();
			const path = "posts/user_1/post-uuid-1";
			const { corpus: corpusHelper } = await import("../corpus");
			const putResult = await corpusHelper.put(corpus, path, mockContent);
			if (!putResult.ok) throw new Error("Setup failed");

			const row = mockPostRow({ corpus_version: putResult.value.hash });
			const updatedRow = mockPostRow({ corpus_version: putResult.value.hash, archived: true });
			const db = createMockDb({
				selectResults: [[row], [], []],
				returning: [updatedRow],
			});
			const service = createPostService({ db, corpus });

			const result = await service.update("user_1", "post-uuid-1", { archived: true });
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.archived).toBe(true);
			}
		});
	});

	describe("list", () => {
		test("returns empty response for no posts", async () => {
			const db = createMockDb({
				selectResults: [[{ count: 0 }], []],
			});
			const corpus = createTestCorpus();
			const service = createPostService({ db, corpus });

			const result = await service.list("user_1", {
				limit: 10,
				offset: 0,
				status: "all",
				archived: false,
				sort: "updated",
			});
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.posts).toEqual([]);
				expect(result.value.total_posts).toBe(0);
				expect(result.value.total_pages).toBe(0);
			}
		});

		test("returns empty when filtering by project with no posts", async () => {
			const db = createMockDb({
				selectResults: [[]],
			});
			const corpus = createTestCorpus();
			const service = createPostService({ db, corpus });

			const result = await service.list("user_1", {
				limit: 10,
				offset: 0,
				status: "all",
				archived: false,
				sort: "updated",
				project: "proj-123",
			});
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.posts).toEqual([]);
				expect(result.value.total_posts).toBe(0);
			}
		});

		test("returns paginated response with posts", async () => {
			const corpus = createTestCorpus();
			const path = "posts/user_1/post-uuid-1";
			const { corpus: corpusHelper } = await import("../corpus");
			const putResult = await corpusHelper.put(corpus, path, mockContent);
			if (!putResult.ok) throw new Error("Setup failed");

			const row = mockPostRow({ corpus_version: putResult.value.hash });
			const db = createMockDb({
				selectResults: [[{ count: 1 }], [row], [], []],
			});
			const service = createPostService({ db, corpus });

			const result = await service.list("user_1", {
				limit: 10,
				offset: 0,
				status: "all",
				archived: false,
				sort: "updated",
			});
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.total_posts).toBe(1);
				expect(result.value.per_page).toBe(10);
				expect(result.value.current_page).toBe(1);
				expect(result.value.posts).toHaveLength(1);
				expect(result.value.posts[0]!.title).toBe("Test Post");
			}
		});
	});

	describe("listVersions", () => {
		test("returns not_found when post does not exist", async () => {
			const db = createMockDb({ selectResults: [[]] });
			const corpus = createTestCorpus();
			const service = createPostService({ db, corpus });

			const result = await service.listVersions("user_1", "missing-uuid");
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("not_found");
			}
		});
	});

	describe("getVersion", () => {
		test("returns not_found when post does not exist", async () => {
			const db = createMockDb({ selectResults: [[]] });
			const corpus = createTestCorpus();
			const service = createPostService({ db, corpus });

			const result = await service.getVersion("user_1", "missing-uuid", "hash");
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("not_found");
			}
		});
	});

	describe("restoreVersion", () => {
		test("returns not_found when post does not exist", async () => {
			const db = createMockDb({ selectResults: [[]] });
			const corpus = createTestCorpus();
			const service = createPostService({ db, corpus });

			const result = await service.restoreVersion("user_1", "missing-uuid", "hash");
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("not_found");
			}
		});
	});
});
