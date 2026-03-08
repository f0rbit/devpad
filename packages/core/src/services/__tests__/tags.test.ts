import { describe, expect, test } from "bun:test";
import { getActiveUserTags, getActiveUserTagsMap, getActiveUserTagsMapByName, getTaskTags, getUserTags, linkTaskToTag, upsertTag } from "../tags.js";

const mockTag = {
	id: "tag_1",
	title: "bug",
	color: "red",
	render: true,
	owner_id: "user_abc",
	created_at: "2024-01-01",
	updated_at: "2024-01-01",
	deleted: false,
};

const mockDeletedTag = {
	...mockTag,
	id: "tag_2",
	title: "archived",
	deleted: true,
};

function createMockDb(results: Record<string, any[]> = {}) {
	const chain: any = {
		select: () => chain,
		from: () => chain,
		where: () => chain,
		orderBy: () => chain,
		limit: () => chain,
		innerJoin: () => chain,
		leftJoin: () => chain,
		groupBy: () => chain,
		insert: () => chain,
		values: () => chain,
		onConflictDoUpdate: () => chain,
		update: () => chain,
		set: () => chain,
		returning: () => results.returning ?? [],
		delete: () => chain,
	};

	return {
		...chain,
		select: (fields?: any) => ({
			...chain,
			from: (table: any) => ({
				...chain,
				where: () => results.select ?? [],
				innerJoin: (joinTable: any, condition: any) => ({
					...chain,
					where: () => results.select ?? [],
				}),
			}),
		}),
		insert: () => ({
			...chain,
			values: (v: any) => ({
				...chain,
				onConflictDoUpdate: () => ({
					...chain,
					returning: () => results.returning ?? [],
				}),
				returning: () => results.returning ?? [],
			}),
		}),
	} as any;
}

describe("tags", () => {
	describe("getUserTags", () => {
		test("returns tags for user", async () => {
			const db = createMockDb({ select: [mockTag] });
			const result = await getUserTags(db, "user_abc");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toEqual([mockTag]);
			}
		});

		test("returns empty array when no tags", async () => {
			const db = createMockDb({ select: [] });
			const result = await getUserTags(db, "user_abc");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toEqual([]);
			}
		});
	});

	describe("getActiveUserTags", () => {
		test("returns active tags", async () => {
			const db = createMockDb({ select: [mockTag] });
			const result = await getActiveUserTags(db, "user_abc");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toEqual([mockTag]);
			}
		});

		test("returns empty when all deleted", async () => {
			const db = createMockDb({ select: [] });
			const result = await getActiveUserTags(db, "user_abc");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toEqual([]);
			}
		});
	});

	describe("getTaskTags", () => {
		test("returns tags linked to task", async () => {
			const db = createMockDb({ select: [mockTag] });
			const result = await getTaskTags(db, "task_1");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toEqual([mockTag]);
			}
		});

		test("returns empty when task has no tags", async () => {
			const db = createMockDb({ select: [] });
			const result = await getTaskTags(db, "task_1");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toEqual([]);
			}
		});
	});

	describe("upsertTag", () => {
		test("returns tag id on success", async () => {
			const db = createMockDb({ returning: [{ id: "tag_new" }] });
			const result = await upsertTag(db, { title: "feature", owner_id: "user_abc", color: "blue", render: true, deleted: false });
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toBe("tag_new");
			}
		});

		test("returns db_error when upsert returns no result", async () => {
			const db = createMockDb({ returning: [] });
			const result = await upsertTag(db, { title: "feature", owner_id: "user_abc", color: "blue", render: true, deleted: false });
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("db_error");
			}
		});

		test("handles empty id by treating as new", async () => {
			const db = createMockDb({ returning: [{ id: "tag_gen" }] });
			const result = await upsertTag(db, { id: "", title: "test", owner_id: "user_abc", color: null, render: true, deleted: false });
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toBe("tag_gen");
			}
		});
	});

	describe("getActiveUserTagsMap", () => {
		test("returns map keyed by id", async () => {
			const db = createMockDb({ select: [mockTag] });
			const result = await getActiveUserTagsMap(db, "user_abc");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.get("tag_1")).toEqual(mockTag);
				expect(result.value.size).toBe(1);
			}
		});

		test("returns empty map when no tags", async () => {
			const db = createMockDb({ select: [] });
			const result = await getActiveUserTagsMap(db, "user_abc");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.size).toBe(0);
			}
		});
	});

	describe("getActiveUserTagsMapByName", () => {
		test("returns map keyed by title", async () => {
			const db = createMockDb({ select: [mockTag] });
			const result = await getActiveUserTagsMapByName(db, "user_abc");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.get("bug")).toEqual(mockTag);
				expect(result.value.size).toBe(1);
			}
		});
	});

	describe("linkTaskToTag", () => {
		test("returns true on success", async () => {
			const db = createMockDb();
			const result = await linkTaskToTag(db, "task_1", "tag_1");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toBe(true);
			}
		});
	});
});
