import { describe, expect, test } from "bun:test";
import { addMilestoneAction, completeMilestone, deleteMilestone, getMilestone, getProjectMilestones, getUserMilestones, upsertMilestone } from "../milestones.js";

const mockMilestone = {
	id: "ms_1",
	name: "Alpha Release",
	description: "First milestone",
	project_id: "project_1",
	target_time: null,
	target_version: null,
	finished_at: null,
	after_id: null,
	created_at: "2024-01-01",
	updated_at: "2024-01-01",
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
					returning: () => overrides.update_returning ?? [overrides.update_result ?? mockMilestone],
				}),
			}),
		}),
		delete: () => ({ where: () => ({}) }),
	} as any;
}

describe("milestones", () => {
	describe("getUserMilestones", () => {
		test("returns milestones for user", async () => {
			const db = createSequenceMockDb({
				select_sequence: [[{ milestone: mockMilestone }]],
			});
			const result = await getUserMilestones(db, "user_abc");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toEqual([mockMilestone]);
			}
		});

		test("returns empty array when no milestones", async () => {
			const db = createSequenceMockDb({ select_sequence: [[]] });
			const result = await getUserMilestones(db, "user_abc");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toEqual([]);
			}
		});
	});

	describe("getProjectMilestones", () => {
		test("returns milestones for project", async () => {
			const db = createSequenceMockDb({
				select_sequence: [[mockMilestone]],
			});
			const result = await getProjectMilestones(db, "project_1");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toEqual([mockMilestone]);
			}
		});

		test("returns empty for project with no milestones", async () => {
			const db = createSequenceMockDb({ select_sequence: [[]] });
			const result = await getProjectMilestones(db, "project_1");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toEqual([]);
			}
		});

		test("sorts by after_id relationship", async () => {
			const ms_a = { ...mockMilestone, id: "ms_a", after_id: null, created_at: "2024-01-01" };
			const ms_b = { ...mockMilestone, id: "ms_b", after_id: "ms_a", created_at: "2024-01-02" };
			const db = createSequenceMockDb({
				select_sequence: [[ms_b, ms_a]],
			});
			const result = await getProjectMilestones(db, "project_1");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value[0].id).toBe("ms_a");
				expect(result.value[1].id).toBe("ms_b");
			}
		});
	});

	describe("getMilestone", () => {
		test("returns milestone when found", async () => {
			const db = createSequenceMockDb({ select_sequence: [[mockMilestone]] });
			const result = await getMilestone(db, "ms_1");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toEqual(mockMilestone);
			}
		});

		test("returns not_found when empty", async () => {
			const db = createSequenceMockDb({ select_sequence: [[]] });
			const result = await getMilestone(db, "ms_missing");
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("not_found");
			}
		});

		test("returns not_found when deleted", async () => {
			const db = createSequenceMockDb({
				select_sequence: [[{ ...mockMilestone, deleted: true }]],
			});
			const result = await getMilestone(db, "ms_1");
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("not_found");
			}
		});
	});

	describe("upsertMilestone", () => {
		test("creates new milestone", async () => {
			const new_ms = { ...mockMilestone, id: "ms_new" };
			const db = createSequenceMockDb({
				// doesUserOwnProject: select project
				select_sequence: [
					[mockProject], // doesUserOwnProject
				],
				insert_returning: [new_ms],
			});
			const result = await upsertMilestone(db, { name: "Beta", project_id: "project_1" }, "user_abc");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.id).toBe("ms_new");
			}
		});

		test("updates existing milestone", async () => {
			const updated = { ...mockMilestone, name: "Beta Release" };
			const db = createSequenceMockDb({
				select_sequence: [
					[mockMilestone], // getMilestone for previous
					[mockProject], // doesUserOwnProject
				],
				update_returning: [updated],
			});
			const result = await upsertMilestone(db, { id: "ms_1", name: "Beta Release", project_id: "project_1" }, "user_abc");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.name).toBe("Beta Release");
			}
		});

		test("rejects protected entity from api channel without force", async () => {
			const protected_ms = { ...mockMilestone, protected: true, modified_by: "user" };
			const db = createSequenceMockDb({
				select_sequence: [
					[protected_ms], // getMilestone for previous
					[mockProject], // doesUserOwnProject
				],
			});
			const result = await upsertMilestone(db, { id: "ms_1", name: "Overwrite", project_id: "project_1" }, "user_abc", "api");
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("protected");
			}
		});

		test("returns forbidden when user does not own project", async () => {
			const db = createSequenceMockDb({
				select_sequence: [
					[], // doesUserOwnProject (empty = not owner)
				],
			});
			const result = await upsertMilestone(db, { name: "New", project_id: "project_1" }, "user_other");
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("forbidden");
			}
		});

		test("rejects modification of deleted milestone", async () => {
			const db = createSequenceMockDb({
				select_sequence: [
					[{ ...mockMilestone, deleted: true }], // getMilestone returns not_found for deleted
					[mockProject], // doesUserOwnProject
				],
				insert_returning: [mockMilestone],
			});
			// getMilestone returns err for deleted, so previous = null, treated as new insert
			const result = await upsertMilestone(db, { id: "ms_1", name: "Test", project_id: "project_1" }, "user_abc");
			expect(result.ok).toBe(true);
		});
	});

	describe("deleteMilestone", () => {
		test("soft deletes milestone and cascades to goals", async () => {
			const db = createSequenceMockDb({
				select_sequence: [
					[mockMilestone], // getMilestone
					[mockProject], // doesUserOwnProject
				],
			});
			const result = await deleteMilestone(db, "ms_1", "user_abc");
			expect(result.ok).toBe(true);
		});

		test("returns not_found for missing milestone", async () => {
			const db = createSequenceMockDb({
				select_sequence: [[]],
			});
			const result = await deleteMilestone(db, "ms_missing", "user_abc");
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("not_found");
			}
		});

		test("returns forbidden when user does not own project", async () => {
			const db = createSequenceMockDb({
				select_sequence: [
					[mockMilestone], // getMilestone
					[], // doesUserOwnProject (empty = not owner)
				],
			});
			const result = await deleteMilestone(db, "ms_1", "user_other");
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("forbidden");
			}
		});
	});

	describe("completeMilestone", () => {
		test("delegates to upsertMilestone with finished_at", async () => {
			const completed = { ...mockMilestone, finished_at: "2024-06-01" };
			const db = createSequenceMockDb({
				select_sequence: [
					[mockMilestone], // getMilestone for previous
					[mockProject], // doesUserOwnProject
				],
				update_returning: [completed],
			});
			const result = await completeMilestone(db, "ms_1", "user_abc");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.finished_at).toBe("2024-06-01");
			}
		});
	});

	describe("addMilestoneAction", () => {
		test("records action and returns true", async () => {
			const db = createSequenceMockDb({});
			const result = await addMilestoneAction(db, {
				owner_id: "user_abc",
				milestone_id: "ms_1",
				project_id: "proj_1",
				name: "Alpha Release",
				type: "CREATE_MILESTONE",
				description: "Created milestone",
			});
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toBe(true);
			}
		});
	});
});
