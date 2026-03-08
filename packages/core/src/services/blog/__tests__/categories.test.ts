import { describe, expect, test } from "bun:test";
import { category, createCategoryService } from "../categories";

const mockCategory = (name: string, parent: string | null = null) => ({
	id: Math.floor(Math.random() * 1000),
	owner_id: "user_1",
	name,
	parent,
});

function createMockDb(opts: { selectResults?: any[][]; returning?: any[] } = {}) {
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
			values: () => ({
				...chain,
				returning: () => Promise.resolve(opts.returning ?? []),
			}),
			returning: () => Promise.resolve(opts.returning ?? []),
			then: (resolve: Function) => resolve(selectResults[resultIndex] ?? []),
		};
		return chain;
	};

	return {
		select: () => {
			const idx = selectCallIndex++;
			return makeChain(idx);
		},
		insert: () => {
			const chain = makeChain(0);
			return {
				...chain,
				values: () => ({
					...chain,
					returning: () => Promise.resolve(opts.returning ?? []),
				}),
			};
		},
		update: () => makeChain(0),
		delete: () => makeChain(0),
	} as any;
}

describe("category.tree (pure)", () => {
	test("empty array returns empty array", () => {
		expect(category.tree([])).toEqual([]);
	});

	test("flat categories with no parents are all top-level", () => {
		const items = [
			{ name: "tech", parent: null },
			{ name: "life", parent: null },
			{ name: "code", parent: null },
		];
		const tree = category.tree(items);
		expect(tree).toHaveLength(3);
		expect(tree.map(n => n.name).sort()).toEqual(["code", "life", "tech"]);
		expect(tree.every(n => n.children.length === 0)).toBe(true);
	});

	test("categories with parent='root' are treated as top-level", () => {
		const items = [
			{ name: "tech", parent: "root" },
			{ name: "life", parent: "root" },
		];
		const tree = category.tree(items);
		expect(tree).toHaveLength(2);
		expect(tree.every(n => n.children.length === 0)).toBe(true);
	});

	test("nested categories have correct parent-child relationships", () => {
		const items = [
			{ name: "tech", parent: null },
			{ name: "javascript", parent: "tech" },
			{ name: "python", parent: "tech" },
			{ name: "life", parent: null },
		];
		const tree = category.tree(items);
		expect(tree).toHaveLength(2);

		const tech = tree.find(n => n.name === "tech")!;
		expect(tech.children).toHaveLength(2);
		expect(tech.children.map(c => c.name).sort()).toEqual(["javascript", "python"]);

		const life = tree.find(n => n.name === "life")!;
		expect(life.children).toHaveLength(0);
	});

	test("multiple nesting levels are preserved", () => {
		const items = [
			{ name: "tech", parent: null },
			{ name: "web", parent: "tech" },
			{ name: "react", parent: "web" },
			{ name: "nextjs", parent: "react" },
		];
		const tree = category.tree(items);
		expect(tree).toHaveLength(1);

		const tech = tree[0]!;
		expect(tech.name).toBe("tech");
		expect(tech.children).toHaveLength(1);

		const web = tech.children[0]!;
		expect(web.name).toBe("web");
		expect(web.children).toHaveLength(1);

		const react = web.children[0]!;
		expect(react.name).toBe("react");
		expect(react.children).toHaveLength(1);

		const nextjs = react.children[0]!;
		expect(nextjs.name).toBe("nextjs");
		expect(nextjs.children).toHaveLength(0);
	});

	test("orphaned categories (parent not in list) become top-level", () => {
		const items = [
			{ name: "react", parent: "web" },
			{ name: "vue", parent: "web" },
		];
		const tree = category.tree(items);
		expect(tree).toHaveLength(2);
	});
});

describe("createCategoryService", () => {
	describe("list", () => {
		test("returns categories from db", async () => {
			const cats = [mockCategory("tech"), mockCategory("life")];
			const db = createMockDb({ selectResults: [cats] });
			const service = createCategoryService({ db });

			const result = await service.list("user_1");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toHaveLength(2);
			}
		});
	});

	describe("find", () => {
		test("returns category when found", async () => {
			const cat = mockCategory("tech");
			const db = createMockDb({ selectResults: [[cat]] });
			const service = createCategoryService({ db });

			const result = await service.find("user_1", "tech");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.name).toBe("tech");
			}
		});

		test("returns not_found when category does not exist", async () => {
			const db = createMockDb({ selectResults: [[]] });
			const service = createCategoryService({ db });

			const result = await service.find("user_1", "missing");
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("not_found");
			}
		});
	});

	describe("create", () => {
		test("creates category successfully", async () => {
			const created = mockCategory("new-cat");
			const db = createMockDb({
				selectResults: [[]],
				returning: [created],
			});
			const service = createCategoryService({ db });

			const result = await service.create("user_1", { name: "new-cat", parent: "root" });
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.name).toBe("new-cat");
			}
		});

		test("returns conflict when name already exists", async () => {
			const existing = mockCategory("tech");
			const db = createMockDb({ selectResults: [[existing]] });
			const service = createCategoryService({ db });

			const result = await service.create("user_1", { name: "tech", parent: "root" });
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("conflict");
			}
		});

		test("returns parent_not_found when parent does not exist", async () => {
			const db = createMockDb({ selectResults: [[], []] });
			const service = createCategoryService({ db });

			const result = await service.create("user_1", { name: "child", parent: "nonexistent" });
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("parent_not_found");
			}
		});
	});

	describe("delete", () => {
		test("deletes category successfully", async () => {
			const cat = mockCategory("tech");
			const db = createMockDb({
				selectResults: [[cat], [], []],
			});
			const service = createCategoryService({ db });

			const result = await service.delete("user_1", "tech");
			expect(result.ok).toBe(true);
		});

		test("returns not_found when category does not exist", async () => {
			const db = createMockDb({ selectResults: [[]] });
			const service = createCategoryService({ db });

			const result = await service.delete("user_1", "missing");
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("not_found");
			}
		});

		test("returns has_children when category has children", async () => {
			const cat = mockCategory("tech");
			const child = mockCategory("web", "tech");
			const db = createMockDb({
				selectResults: [[cat], [child]],
			});
			const service = createCategoryService({ db });

			const result = await service.delete("user_1", "tech");
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("has_children");
			}
		});

		test("returns has_posts when category has posts", async () => {
			const cat = mockCategory("tech");
			const post = { id: 1, category: "tech" };
			const db = createMockDb({
				selectResults: [[cat], [], [post]],
			});
			const service = createCategoryService({ db });

			const result = await service.delete("user_1", "tech");
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("has_posts");
			}
		});
	});

	describe("getTree", () => {
		test("returns tree from flat list", async () => {
			const cats = [mockCategory("tech"), mockCategory("javascript", "tech"), mockCategory("life")];
			const db = createMockDb({ selectResults: [cats] });
			const service = createCategoryService({ db });

			const result = await service.getTree("user_1");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toHaveLength(2);
				const tech = result.value.find(n => n.name === "tech")!;
				expect(tech.children).toHaveLength(1);
				expect(tech.children[0]!.name).toBe("javascript");
			}
		});
	});

	describe("update", () => {
		test("returns same category when name unchanged", async () => {
			const cat = mockCategory("tech");
			const db = createMockDb({ selectResults: [[cat]] });
			const service = createCategoryService({ db });

			const result = await service.update("user_1", "tech", { name: "tech" });
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.name).toBe("tech");
			}
		});

		test("returns not_found when category does not exist", async () => {
			const db = createMockDb({ selectResults: [[]] });
			const service = createCategoryService({ db });

			const result = await service.update("user_1", "missing", { name: "new" });
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("not_found");
			}
		});

		test("returns conflict when new name already exists", async () => {
			const cat = mockCategory("tech");
			const existing = mockCategory("life");
			const db = createMockDb({ selectResults: [[cat], [existing]] });
			const service = createCategoryService({ db });

			const result = await service.update("user_1", "tech", { name: "life" });
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("conflict");
			}
		});
	});
});
