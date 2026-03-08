import { describe, expect, test } from "bun:test";
import { getUserByEmail, getUserByGithubId, getUserById, updateUserPreferences } from "../users.js";

const mockUser = {
	id: "user_abc",
	github_id: 12345,
	username: "testuser",
	email: "test@example.com",
	avatar_url: "https://example.com/avatar.png",
	task_view: "list",
	created_at: "2024-01-01",
	updated_at: "2024-01-01",
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
		select: () => ({
			...chain,
			from: (table: any) => ({
				...chain,
				where: () => results.select ?? [],
			}),
		}),
		update: () => ({
			...chain,
			set: () => ({
				...chain,
				where: () => ({
					...chain,
					returning: () => results.returning ?? [],
				}),
			}),
		}),
	} as any;
}

describe("users", () => {
	describe("getUserById", () => {
		test("returns user when found", async () => {
			const db = createMockDb({ select: [mockUser] });
			const result = await getUserById(db, "user_abc");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toEqual(mockUser);
			}
		});

		test("returns null when not found", async () => {
			const db = createMockDb({ select: [] });
			const result = await getUserById(db, "user_missing");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toBeNull();
			}
		});
	});

	describe("getUserByGithubId", () => {
		test("returns user when found", async () => {
			const db = createMockDb({ select: [mockUser] });
			const result = await getUserByGithubId(db, 12345);
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toEqual(mockUser);
			}
		});

		test("returns null when not found", async () => {
			const db = createMockDb({ select: [] });
			const result = await getUserByGithubId(db, 99999);
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toBeNull();
			}
		});
	});

	describe("getUserByEmail", () => {
		test("returns user when found", async () => {
			const db = createMockDb({ select: [mockUser] });
			const result = await getUserByEmail(db, "test@example.com");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toEqual(mockUser);
			}
		});

		test("returns null when not found", async () => {
			const db = createMockDb({ select: [] });
			const result = await getUserByEmail(db, "missing@example.com");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toBeNull();
			}
		});
	});

	describe("updateUserPreferences", () => {
		test("returns updated user on success", async () => {
			const updated = { ...mockUser, task_view: "grid" };
			const db = createMockDb({ returning: [updated] });
			const result = await updateUserPreferences(db, "user_abc", { id: "user_abc", task_view: "grid" });
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.task_view).toBe("grid");
			}
		});

		test("returns not_found when user does not exist", async () => {
			const db = createMockDb({ returning: [] });
			const result = await updateUserPreferences(db, "user_missing", { id: "user_missing", task_view: "grid" });
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("not_found");
				if (result.error.kind === "not_found") {
					expect(result.error.resource).toBe("user");
				}
			}
		});
	});
});
