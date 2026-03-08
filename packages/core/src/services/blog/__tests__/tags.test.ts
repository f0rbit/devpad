import { describe, expect, test } from "bun:test";
import { createTagService } from "../tags";

function createMockDb(opts: { selectResults?: any[][]; insertCalled?: { value: boolean } } = {}) {
	let selectCallIndex = 0;
	const selectResults = opts.selectResults ?? [[]];

	const makeChain = (resultIndex: number): any => {
		const chain: any = {
			from: () => chain,
			where: () => chain,
			orderBy: () => chain,
			limit: () => chain,
			leftJoin: () => chain,
			innerJoin: () => chain,
			groupBy: () => chain,
			set: () => chain,
			values: (v: any) => {
				if (opts.insertCalled) opts.insertCalled.value = true;
				return chain;
			},
			returning: () => Promise.resolve([]),
			then: (resolve: Function) => resolve(selectResults[resultIndex] ?? []),
		};
		return chain;
	};

	return {
		select: (...args: any[]) => {
			const idx = selectCallIndex++;
			return makeChain(idx);
		},
		insert: () => makeChain(0),
		update: () => makeChain(0),
		delete: () => makeChain(0),
	} as any;
}

describe("createTagService", () => {
	describe("list", () => {
		test("returns tags with counts", async () => {
			const tagRows = [
				{ tag: "javascript", count: 5 },
				{ tag: "typescript", count: 3 },
			];
			const db = createMockDb({ selectResults: [tagRows] });
			const service = createTagService({ db });

			const result = await service.list("user_1");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toHaveLength(2);
				expect(result.value[0]!.tag).toBe("javascript");
				expect(result.value[0]!.count).toBe(5);
				expect(result.value[1]!.tag).toBe("typescript");
				expect(result.value[1]!.count).toBe(3);
			}
		});

		test("returns empty array when no tags exist", async () => {
			const db = createMockDb({ selectResults: [[]] });
			const service = createTagService({ db });

			const result = await service.list("user_1");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toEqual([]);
			}
		});
	});

	describe("getPostTags", () => {
		test("returns tag names for a post", async () => {
			const tagRows = [{ tag: "javascript" }, { tag: "web" }];
			const db = createMockDb({ selectResults: [tagRows] });
			const service = createTagService({ db });

			const result = await service.getPostTags(1);
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toEqual(["javascript", "web"]);
			}
		});

		test("returns empty array when post has no tags", async () => {
			const db = createMockDb({ selectResults: [[]] });
			const service = createTagService({ db });

			const result = await service.getPostTags(1);
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toEqual([]);
			}
		});
	});

	describe("setPostTags", () => {
		test("replaces all tags with new ones", async () => {
			const db = createMockDb();
			const service = createTagService({ db });

			const result = await service.setPostTags(1, ["react", "nextjs"]);
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toEqual(["react", "nextjs"]);
			}
		});

		test("deduplicates tags", async () => {
			const db = createMockDb();
			const service = createTagService({ db });

			const result = await service.setPostTags(1, ["react", "react", "nextjs"]);
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toEqual(["react", "nextjs"]);
			}
		});

		test("handles empty tag list", async () => {
			const insertCalled = { value: false };
			const db = createMockDb({ insertCalled });
			const service = createTagService({ db });

			const result = await service.setPostTags(1, []);
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toEqual([]);
			}
			expect(insertCalled.value).toBe(false);
		});
	});

	describe("addPostTags", () => {
		test("adds new tags to existing ones", async () => {
			const existing = [{ tag: "javascript" }];
			const db = createMockDb({ selectResults: [existing] });
			const service = createTagService({ db });

			const result = await service.addPostTags(1, ["react", "typescript"]);
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toEqual(["javascript", "react", "typescript"]);
			}
		});

		test("skips tags that already exist", async () => {
			const existing = [{ tag: "javascript" }, { tag: "react" }];
			const insertCalled = { value: false };
			const db = createMockDb({ selectResults: [existing], insertCalled });
			const service = createTagService({ db });

			const result = await service.addPostTags(1, ["javascript", "react"]);
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toEqual(["javascript", "react"]);
			}
			expect(insertCalled.value).toBe(false);
		});
	});

	describe("removePostTag", () => {
		test("removes existing tag", async () => {
			const existing = [{ post_id: 1, tag: "javascript" }];
			const db = createMockDb({ selectResults: [existing] });
			const service = createTagService({ db });

			const result = await service.removePostTag(1, "javascript");
			expect(result.ok).toBe(true);
		});

		test("returns not_found when tag does not exist on post", async () => {
			const db = createMockDb({ selectResults: [[]] });
			const service = createTagService({ db });

			const result = await service.removePostTag(1, "nonexistent");
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("not_found");
			}
		});
	});

	describe("findPost", () => {
		test("returns post when found", async () => {
			const post = { id: 1, uuid: "abc-123", author_id: "user_1", slug: "test" };
			const db = createMockDb({ selectResults: [[post]] });
			const service = createTagService({ db });

			const result = await service.findPost("user_1", "abc-123");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.uuid).toBe("abc-123");
			}
		});

		test("returns not_found when post does not exist", async () => {
			const db = createMockDb({ selectResults: [[]] });
			const service = createTagService({ db });

			const result = await service.findPost("user_1", "missing-uuid");
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("not_found");
			}
		});
	});
});
