import { type Category, type CategoryCreate, type DrizzleDB, err, ok, type Result, try_catch_async } from "@devpad/schema/blog";
import { blog_categories as categories, blog_posts as posts } from "@devpad/schema/database/blog";
import { and, eq } from "drizzle-orm";
import { errors, rows } from "../utils/service-helpers";

type CategoryServiceError =
	| { kind: "not_found"; resource: string }
	| { kind: "conflict"; message: string }
	| { kind: "parent_not_found"; message: string }
	| { kind: "has_children" }
	| { kind: "has_posts" }
	| { kind: "db_error"; message: string };

export type CategoryUpdate = {
	name: string;
};

export type CategoryNode = {
	name: string;
	parent: string | null;
	children: CategoryNode[];
};

type Deps = {
	db: DrizzleDB;
};

const toDbError = (e: unknown): CategoryServiceError => errors.db(e);

const notFound = (resource: string): CategoryServiceError => errors.missing(resource);

const conflict = (message: string): CategoryServiceError => ({
	kind: "conflict",
	message,
});

const firstRow = <T>(r: T[], resource: string): Result<T, CategoryServiceError> => rows.firstOr(r, () => notFound(resource));

type CategoryLike = { name: string; parent: string | null };

const buildTree = <T extends CategoryLike>(items: T[]): CategoryNode[] => {
	const nodeMap = new Map<string, CategoryNode>();

	for (const cat of items) {
		nodeMap.set(cat.name, { name: cat.name, parent: cat.parent, children: [] });
	}

	const roots: CategoryNode[] = [];

	for (const node of nodeMap.values()) {
		if (!node.parent || node.parent === "root") {
			roots.push(node);
			continue;
		}

		const parent = nodeMap.get(node.parent);
		if (parent) {
			parent.children.push(node);
		} else {
			roots.push(node);
		}
	}

	return roots;
};

export const category = {
	tree: buildTree,
};

export const createCategoryService = ({ db }: Deps) => {
	const list = async (userId: string): Promise<Result<Category[], CategoryServiceError>> => try_catch_async(async () => db.select().from(categories).where(eq(categories.owner_id, userId)), toDbError);

	const getTree = async (userId: string): Promise<Result<CategoryNode[], CategoryServiceError>> => {
		const result = await list(userId);
		if (!result.ok) return result;
		return ok(category.tree(result.value));
	};

	const find = async (userId: string, name: string): Promise<Result<Category, CategoryServiceError>> => {
		const rows = await db
			.select()
			.from(categories)
			.where(and(eq(categories.owner_id, userId), eq(categories.name, name)))
			.limit(1);

		return firstRow(rows, `category:${name}`);
	};

	const hasChildren = async (userId: string, name: string): Promise<boolean> => {
		const children = await db
			.select()
			.from(categories)
			.where(and(eq(categories.owner_id, userId), eq(categories.parent, name)))
			.limit(1);

		return children.length > 0;
	};

	const hasPosts = async (userId: string, name: string): Promise<boolean> => {
		const postsInCategory = await db
			.select()
			.from(posts)
			.where(and(eq(posts.author_id, userId), eq(posts.category, name)))
			.limit(1);

		return postsInCategory.length > 0;
	};

	const create = async (userId: string, input: CategoryCreate): Promise<Result<Category, CategoryServiceError>> => {
		const existing = await find(userId, input.name);
		if (existing.ok) {
			return err(conflict("Category with this name already exists"));
		}

		if (input.parent && input.parent !== "root") {
			const parentResult = await find(userId, input.parent);
			if (!parentResult.ok) {
				return err({ kind: "parent_not_found", message: "Parent category does not exist" });
			}
		}

		return try_catch_async(async () => {
			const [created] = await db
				.insert(categories)
				.values({
					owner_id: userId,
					name: input.name,
					parent: input.parent ?? "root",
				})
				.returning();

			if (!created) throw new Error("Insert returned no rows");
			return created;
		}, toDbError);
	};

	const update = async (userId: string, name: string, input: CategoryUpdate): Promise<Result<Category, CategoryServiceError>> => {
		const existingResult = await find(userId, name);
		if (!existingResult.ok) return existingResult;

		if (name === input.name) {
			return ok(existingResult.value);
		}

		const newNameExists = await find(userId, input.name);
		if (newNameExists.ok) {
			return err(conflict("Category with this name already exists"));
		}

		return try_catch_async(async () => {
			await db
				.update(categories)
				.set({ parent: input.name })
				.where(and(eq(categories.owner_id, userId), eq(categories.parent, name)));

			await db
				.update(posts)
				.set({ category: input.name })
				.where(and(eq(posts.author_id, userId), eq(posts.category, name)));

			const [updated] = await db
				.update(categories)
				.set({ name: input.name })
				.where(and(eq(categories.owner_id, userId), eq(categories.name, name)))
				.returning();

			if (!updated) throw new Error("Update returned no rows");
			return updated;
		}, toDbError);
	};

	const remove = async (userId: string, name: string): Promise<Result<void, CategoryServiceError>> => {
		const existingResult = await find(userId, name);
		if (!existingResult.ok) return existingResult;

		if (await hasChildren(userId, name)) {
			return err({ kind: "has_children" });
		}

		if (await hasPosts(userId, name)) {
			return err({ kind: "has_posts" });
		}

		return try_catch_async(async () => {
			await db.delete(categories).where(and(eq(categories.owner_id, userId), eq(categories.name, name)));
		}, toDbError);
	};

	return {
		list,
		getTree,
		find,
		create,
		update,
		delete: remove,
	};
};

export type CategoryService = ReturnType<typeof createCategoryService>;
