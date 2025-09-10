import type { Nullable, Project, Tag, Task, UpsertProject, UpsertTag, UpsertTodo } from "@devpad/schema";
import { TEST_USER_ID } from "./setup";

type UpsertTaskOverrides = Nullable<UpsertTodo> & Partial<Pick<UpsertTodo, "id" | "owner_id" | "title" | "progress" | "priority" | "visibility" | "project_id">>;
type UpsertProjectOverrides = Partial<UpsertProject>;

export class TestDataFactory {
	private static counter = 0;

	public static getNextId(): string {
		return `test-${Date.now()}-${++TestDataFactory.counter}`;
	}

	static createProject(owner_id: string, overrides: UpsertProjectOverrides): Project {
		const id = TestDataFactory.getNextId();
		return {
			id: overrides.id ?? id,
			owner_id: overrides.owner_id ?? owner_id,
			name: overrides.name ?? `Test Project ${id}`,
			project_id: overrides.project_id ?? `test-project-${id}`,
			description: overrides.description ?? `A test project created at ${new Date().toISOString()}`,
			status: overrides.status ?? "DEVELOPMENT",
			visibility: overrides.visibility ?? "PRIVATE",
			deleted: overrides.deleted ?? false,
			scan_branch: null,
			specification: overrides.specification ?? null,
			current_version: overrides.current_version ?? null,
			icon_url: null,
			link_text: null,
			link_url: null,
			repo_url: null,
			repo_id: null,
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
		};
	}

	static createTask(overrides: UpsertTaskOverrides): Task {
		const id = TestDataFactory.getNextId();
		return {
			title: `Test Task ${id}`,
			description: `A test task created at ${new Date().toISOString()}`,
			progress: "UNSTARTED",
			priority: "MEDIUM",
			visibility: "PRIVATE",
			updated_at: new Date().toISOString(),
			created_at: new Date().toISOString(),
			deleted: false,
			goal_id: null,
			codebase_task_id: null,
			...overrides,
			id: id,
			project_id: overrides.project_id || null,
			start_time: overrides.start_time || null,
			end_time: overrides.end_time || null,
			summary: overrides.summary || null,
		};
	}

	static createTag(owner_id: string, overrides: Partial<UpsertTag> = {}): Tag {
		const id = TestDataFactory.getNextId();
		return {
			id: id,
			owner_id,
			title: `Test Tag ${id}`,
			color: "blue",
			deleted: false,
			render: true,
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
			...overrides,
		};
	}

	static createRealisticProject(owner_id: string = TEST_USER_ID, overrides: Partial<UpsertProjectOverrides> = {}): Project {
		const id = TestDataFactory.getNextId();
		return TestDataFactory.createProject(owner_id, {
			id: id,
			name: `DevPad Integration Test ${id}`,
			project_id: `devpad-test-${id}`,
			description: "Integration test project for testing API functionality",
			specification: "# Test Project\n\nThis project is used for testing the devpad API integration.",
			status: "DEVELOPMENT",
			visibility: "PUBLIC",
			deleted: false,
			link_url: "https://github.com/test/project",
			link_text: "View on GitHub",
			current_version: "0.1.0",
			repo_url: null,
			repo_id: null,
			icon_url: null,
			...overrides,
		});
	}

	// Create multiple test tags for a user
	static createTestTags(owner_id: string, count: number = 3): Tag[] {
		const colors: Array<UpsertTag["color"]> = ["red", "green", "blue", "yellow", "purple"];
		const tagTypes = ["bug", "feature", "enhancement", "documentation", "test"];

		return Array.from({ length: count }, (_, i) => ({
			id: TestDataFactory.getNextId(),
			owner_id,
			title: tagTypes[i % tagTypes.length],
			color: colors[i % colors.length] ?? null,
			deleted: false,
			render: true,
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
		}));
	}
}
