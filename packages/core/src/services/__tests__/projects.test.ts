import { describe, expect, mock, test } from "bun:test";
import { addProjectAction, doesUserOwnProject, getProject, getProjectById, getUserProjectMap, getUserProjects } from "../projects.js";

const mockProject = {
	id: "project_123",
	project_id: "my-project",
	name: "Test Project",
	description: "A test project",
	specification: null,
	repo_url: null,
	repo_id: null,
	icon_url: null,
	status: "DEVELOPMENT",
	link_url: null,
	link_text: null,
	visibility: "PRIVATE",
	current_version: null,
	scan_branch: null,
	owner_id: "user_abc",
	created_at: "2024-01-01",
	updated_at: "2024-01-01",
	deleted: false,
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
		insert: () => ({
			...chain,
			values: () => ({
				...chain,
				onConflictDoUpdate: () => ({
					...chain,
					returning: () => results.returning ?? [],
				}),
				returning: () => results.returning ?? [],
			}),
		}),
	};
}

describe("projects", () => {
	describe("getProjectById", () => {
		test("returns validation error for empty project_id", async () => {
			const db = createMockDb();
			const result = await getProjectById(db, "");
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("validation");
			}
		});

		test("returns not_found when no project exists", async () => {
			const db = createMockDb({ select: [] });
			const result = await getProjectById(db, "project_nonexistent");
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("not_found");
				if (result.error.kind === "not_found") {
					expect(result.error.entity).toBe("project");
				}
			}
		});

		test("returns project when found", async () => {
			const db = createMockDb({ select: [mockProject] });
			const result = await getProjectById(db, "project_123");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.id).toBe("project_123");
				expect(result.value.name).toBe("Test Project");
			}
		});
	});

	describe("getUserProjects", () => {
		test("returns empty array when user has no projects", async () => {
			const db = createMockDb({ select: [] });
			const result = await getUserProjects(db, "user_abc");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toEqual([]);
			}
		});

		test("returns projects for user", async () => {
			const db = createMockDb({ select: [mockProject] });
			const result = await getUserProjects(db, "user_abc");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.length).toBe(1);
				expect(result.value[0].id).toBe("project_123");
			}
		});
	});

	describe("doesUserOwnProject", () => {
		test("returns true when user owns project", async () => {
			const db = createMockDb({ select: [mockProject] });
			const result = await doesUserOwnProject(db, "user_abc", "project_123");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toBe(true);
			}
		});

		test("returns false when user does not own project", async () => {
			const db = createMockDb({ select: [] });
			const result = await doesUserOwnProject(db, "user_other", "project_123");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toBe(false);
			}
		});
	});

	describe("getProject", () => {
		test("returns not_found when project not found", async () => {
			const db = createMockDb({ select: [] });
			const result = await getProject(db, "user_abc", "nonexistent");
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("not_found");
			}
		});
	});

	describe("getUserProjectMap", () => {
		test("returns map of projects", async () => {
			const db = createMockDb({ select: [mockProject] });
			const result = await getUserProjectMap(db, "user_abc");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value["project_123"]).toBeDefined();
				expect(result.value["project_123"].name).toBe("Test Project");
			}
		});
	});
});
