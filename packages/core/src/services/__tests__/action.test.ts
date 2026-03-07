import { describe, expect, test } from "bun:test";
import { getActions, getAIActivity, getUserHistory } from "../action.js";

const mockAction = {
	id: "act_1",
	owner_id: "user_abc",
	type: "CREATE_PROJECT",
	description: "Created project",
	data: { project_id: "project_1" },
	channel: "user",
	created_at: "2024-01-15T10:00:00Z",
	deleted: false,
	created_by: "user",
	modified_by: "user",
	protected: false,
};

const mockProject = {
	id: "project_1",
	project_id: "my-project",
	name: "Test Project",
	owner_id: "user_abc",
	visibility: "PRIVATE",
	deleted: false,
};

function createSequenceMockDb(overrides: Record<string, any> = {}) {
	let call_count = 0;
	const select_results = overrides.select_sequence ?? [];

	const resolve = () => {
		const result = select_results[call_count] ?? [];
		call_count++;
		return result;
	};

	const make_chain = (): any => {
		let resolved: any[] | null = null;
		const get = () => {
			if (resolved === null) resolved = resolve();
			return resolved;
		};

		const self: any = {
			select: () => make_chain(),
			from: () => self,
			where: () => make_chain(),
			orderBy: () => self,
			limit: () => make_chain(),
			innerJoin: () => self,
			leftJoin: () => self,
			groupBy: () => make_chain(),
			then: (onFulfilled: any, onRejected?: any) => Promise.resolve(get()).then(onFulfilled, onRejected),
			map: (...args: any[]) => get().map(...args),
			filter: (...args: any[]) => get().filter(...args),
			sort: (...args: any[]) => get().sort(...args),
			concat: (...args: any[]) => get().concat(...args),
			[Symbol.iterator]: () => get()[Symbol.iterator](),
			get [0]() {
				return get()[0];
			},
		};

		Object.defineProperty(self, "length", { get: () => get().length });
		return self;
	};

	return {
		select: (fields?: any) => make_chain(),
		insert: () => ({
			values: (v: any) => ({
				returning: () => overrides.insert_returning ?? [{ id: "new_1" }],
				onConflictDoUpdate: () => ({
					returning: () => overrides.insert_returning ?? [{ id: "new_1" }],
				}),
			}),
		}),
		update: () => ({
			set: (v: any) => ({
				where: () => ({
					returning: () => overrides.update_returning ?? [],
				}),
			}),
		}),
		delete: () => ({ where: () => ({}) }),
	} as any;
}

describe("action", () => {
	describe("getActions", () => {
		test("returns actions with enriched project data", async () => {
			const db = createSequenceMockDb({
				select_sequence: [
					[mockAction], // raw action query
					[mockProject], // getUserProjects (for getUserProjectMap)
				],
			});
			const result = await getActions(db, "user_abc", null);
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.length).toBe(1);
				expect(result.value[0].data.name).toBe("Test Project");
				expect(result.value[0].data.href).toBe("my-project");
			}
		});

		test("returns empty when no actions", async () => {
			const db = createSequenceMockDb({
				select_sequence: [
					[], // raw action query
					[], // getUserProjects
				],
			});
			const result = await getActions(db, "user_abc", null);
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toEqual([]);
			}
		});

		test("returns actions with filter", async () => {
			const db = createSequenceMockDb({
				select_sequence: [
					[mockAction], // filtered action query
					[mockProject], // getUserProjects
				],
			});
			const result = await getActions(db, "user_abc", ["CREATE_PROJECT"]);
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.length).toBe(1);
			}
		});
	});

	describe("getUserHistory", () => {
		test("returns sorted history actions", async () => {
			const action_old = { ...mockAction, id: "act_old", created_at: "2024-01-01T10:00:00Z" };
			const action_new = { ...mockAction, id: "act_new", created_at: "2024-01-15T10:00:00Z" };
			const db = createSequenceMockDb({
				select_sequence: [
					[action_old, action_new], // getActions raw
					[mockProject], // getUserProjects
				],
			});
			const result = await getUserHistory(db, "user_abc");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.length).toBe(2);
				expect(result.value[0].created_at).toBe("2024-01-15T10:00:00Z");
				expect(result.value[1].created_at).toBe("2024-01-01T10:00:00Z");
			}
		});

		test("returns empty when no history", async () => {
			const db = createSequenceMockDb({
				select_sequence: [
					[], // getActions raw
					[], // getUserProjects
				],
			});
			const result = await getUserHistory(db, "user_abc");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toEqual([]);
			}
		});
	});

	describe("getAIActivity", () => {
		test("groups actions into sessions by time gap", async () => {
			const api_actions = [
				{ ...mockAction, id: "a1", channel: "api", created_at: "2024-01-15T10:00:00Z" },
				{ ...mockAction, id: "a2", channel: "api", created_at: "2024-01-15T10:05:00Z" },
				{ ...mockAction, id: "a3", channel: "api", created_at: "2024-01-15T11:00:00Z" },
			];
			const db = createSequenceMockDb({
				select_sequence: [
					api_actions, // ai actions query
					[mockProject], // getUserProjects
				],
			});
			const result = await getAIActivity(db, "user_abc");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.length).toBe(2);
				expect(result.value[0].action_count).toBe(2);
				expect(result.value[1].action_count).toBe(1);
			}
		});

		test("returns empty when no api actions", async () => {
			const db = createSequenceMockDb({
				select_sequence: [
					[], // ai actions query
					[], // getUserProjects
				],
			});
			const result = await getAIActivity(db, "user_abc");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toEqual([]);
			}
		});

		test("single action forms one session", async () => {
			const db = createSequenceMockDb({
				select_sequence: [[{ ...mockAction, channel: "api" }], [mockProject]],
			});
			const result = await getAIActivity(db, "user_abc");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.length).toBe(1);
				expect(result.value[0].action_count).toBe(1);
				expect(result.value[0].entities_touched).toContain("project_1");
			}
		});

		test("respects limit option", async () => {
			const actions = Array.from({ length: 30 }, (_, i) => ({
				...mockAction,
				id: `a_${i}`,
				channel: "api",
				created_at: new Date(2024, 0, 1, i).toISOString(),
			}));
			const db = createSequenceMockDb({
				select_sequence: [actions, [mockProject]],
			});
			const result = await getAIActivity(db, "user_abc", { limit: 5 });
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.length).toBeLessThanOrEqual(5);
			}
		});

		test("session has correct summary", async () => {
			const api_actions = [
				{ ...mockAction, id: "a1", channel: "api", type: "CREATE_TASK", created_at: "2024-01-15T10:00:00Z" },
				{ ...mockAction, id: "a2", channel: "api", type: "CREATE_TASK", created_at: "2024-01-15T10:01:00Z" },
				{ ...mockAction, id: "a3", channel: "api", type: "UPDATE_PROJECT", created_at: "2024-01-15T10:02:00Z" },
			];
			const db = createSequenceMockDb({
				select_sequence: [api_actions, [mockProject]],
			});
			const result = await getAIActivity(db, "user_abc");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.length).toBe(1);
				expect(result.value[0].summary).toContain("Created tasks: 2");
				expect(result.value[0].summary).toContain("Updated project: 1");
			}
		});
	});
});
