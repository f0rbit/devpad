import { describe, expect, mock, test } from "bun:test";

mock.module("@devpad/scanner", () => ({
	scanGitHubRepo: async () => ({
		ok: true,
		value: [{ id: "task_1", file: "src/main.ts", line: 10, tag: "todo", text: "Fix this", context: ["line 9", "line 10", "line 11"] }],
	}),
	generateDiff: (old_tasks: any[], new_tasks: any[]) => [{ id: "task_1", tag: "todo", type: "NEW", data: { old: null, new: { text: "Fix this", line: 10, file: "src/main.ts", context: [] } } }],
}));

const { initiateScan, getPendingUpdates, getScanHistory } = await import("../scanning.d1.js");

const mockProjectRow = {
	id: "project_123",
	project_id: "my-project",
	name: "Test Project",
	repo_url: "https://github.com/owner/repo",
	repo_id: 12345,
	scan_branch: "main",
	owner_id: "user_abc",
	status: "DEVELOPMENT",
	visibility: "PRIVATE",
	created_at: "2024-01-01",
	updated_at: "2024-01-01",
	deleted: false,
};

function createScanMockDb(overrides: Record<string, any> = {}) {
	let call_count = 0;
	const select_results = overrides.select_sequence ?? [];

	const resolve = () => {
		const result = select_results[call_count] ?? [];
		call_count++;
		return result;
	};

	const make_result_chain = (): any => {
		let resolved: any[] | null = null;
		const get_resolved = () => {
			if (resolved === null) resolved = resolve();
			return resolved;
		};

		const self: any = {
			select: () => make_result_chain(),
			from: () => self,
			where: () => make_result_chain(),
			orderBy: () => self,
			limit: () => make_result_chain(),
			innerJoin: () => self,
			leftJoin: () => self,
			groupBy: () => make_result_chain(),
			then: (onFulfilled: any, onRejected?: any) => Promise.resolve(get_resolved()).then(onFulfilled, onRejected),
			map: (...args: any[]) => get_resolved().map(...args),
			filter: (...args: any[]) => get_resolved().filter(...args),
			length: 0,
			[Symbol.iterator]: () => get_resolved()[Symbol.iterator](),
			get [0]() {
				return get_resolved()[0];
			},
		};

		Object.defineProperty(self, "length", { get: () => get_resolved().length });

		return self;
	};

	return {
		select: () => make_result_chain(),
		insert: () => ({
			values: (v: any) => ({
				returning: () => overrides.insert_returning ?? [{ id: 1 }],
				onConflictDoUpdate: () => ({
					returning: () => overrides.insert_returning ?? [{ id: 1 }],
				}),
			}),
		}),
		update: () => ({
			set: () => ({
				where: () => ({}),
			}),
		}),
	};
}

describe("scanning.d1", () => {
	describe("initiateScan", () => {
		test("is an async generator", () => {
			const db = createScanMockDb();
			const generator = initiateScan(db, "project_123", "user_abc", "token_abc");
			expect(generator[Symbol.asyncIterator]).toBeDefined();
		});

		test("yields error for missing project", async () => {
			const db = createScanMockDb({
				select_sequence: [[]],
			});

			const messages: string[] = [];
			for await (const msg of initiateScan(db, "project_123", "user_abc", "token_abc")) {
				messages.push(msg);
			}

			expect(messages).toContain("starting\n");
			expect(messages.some(m => m.includes("error: project not found"))).toBe(true);
		});

		test("yields error for project without repo", async () => {
			const project_no_repo = { ...mockProjectRow, repo_url: null };
			const db = createScanMockDb({
				select_sequence: [[project_no_repo]],
			});

			const messages: string[] = [];
			for await (const msg of initiateScan(db, "project_123", "user_abc", "token_abc")) {
				messages.push(msg);
			}

			expect(messages).toContain("starting\n");
			expect(messages.some(m => m.includes("error: project not linked"))).toBe(true);
		});

		test("yields progress messages for successful scan", async () => {
			const db = createScanMockDb({
				select_sequence: [[mockProjectRow], [mockProjectRow], [{ id: "tag_1", title: "todo", matches: '["TODO"]' }], [], []],
				insert_returning: [{ id: 1 }],
			});

			const messages: string[] = [];
			for await (const msg of initiateScan(db, "project_123", "user_abc", "token_abc")) {
				messages.push(msg);
			}

			expect(messages).toContain("starting\n");
			expect(messages.some(m => m.includes("scanning repo") || m.includes("loading config"))).toBe(true);
		});
	});

	describe("getPendingUpdates", () => {
		test("returns not_found for non-owned project", async () => {
			const db = createScanMockDb({ select_sequence: [[]] });
			const result = await getPendingUpdates(db, "project_123", "user_wrong");
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("not_found");
			}
		});
	});

	describe("getScanHistory", () => {
		test("returns not_found for non-owned project", async () => {
			const db = createScanMockDb({ select_sequence: [[]] });
			const result = await getScanHistory(db, "project_123", "user_wrong");
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("not_found");
			}
		});
	});
});
