import { type DrizzleDB, err, ok, type PostRow, type Result, try_catch_async } from "@devpad/schema/blog";
import { blog_posts as posts, blog_tags as tags } from "@devpad/schema/database/blog";
import { and, eq, sql } from "drizzle-orm";

type TagServiceError = { kind: "not_found"; resource: string } | { kind: "db_error"; message: string };

export type TagWithCount = {
	tag: string;
	count: number;
};

type Deps = {
	db: DrizzleDB;
};

const toDbError = (e: unknown): TagServiceError => ({
	kind: "db_error",
	message: e instanceof Error ? e.message : String(e),
});

const notFound = (resource: string): TagServiceError => ({
	kind: "not_found",
	resource,
});

export const createTagService = ({ db }: Deps) => {
	const findPost = async (userId: string, uuid: string): Promise<Result<PostRow, TagServiceError>> => {
		const [post] = await db
			.select()
			.from(posts)
			.where(and(eq(posts.author_id, userId), eq(posts.uuid, uuid)))
			.limit(1);

		if (!post) return err(notFound(`post:${uuid}`));
		return ok(post);
	};
	const list = async (userId: string): Promise<Result<TagWithCount[], TagServiceError>> =>
		try_catch_async(async () => {
			const tagCounts = await db
				.select({
					tag: tags.tag,
					count: sql<number>`count(*)`.as("count"),
				})
				.from(tags)
				.innerJoin(posts, eq(tags.post_id, posts.id))
				.where(eq(posts.author_id, userId))
				.groupBy(tags.tag)
				.orderBy(tags.tag);

			return tagCounts.map(row => ({
				tag: row.tag,
				count: Number(row.count),
			}));
		}, toDbError);

	const getPostTags = async (postId: number): Promise<Result<string[], TagServiceError>> =>
		try_catch_async(async () => {
			const rows = await db.select({ tag: tags.tag }).from(tags).where(eq(tags.post_id, postId));

			return rows.map(t => t.tag);
		}, toDbError);

	const setPostTags = async (postId: number, newTags: string[]): Promise<Result<string[], TagServiceError>> =>
		try_catch_async(async () => {
			await db.delete(tags).where(eq(tags.post_id, postId));

			const uniqueTags = [...new Set(newTags)];

			if (uniqueTags.length > 0) {
				await db.insert(tags).values(uniqueTags.map(tag => ({ post_id: postId, tag })));
			}

			return uniqueTags;
		}, toDbError);

	const addPostTags = async (postId: number, tagsToAdd: string[]): Promise<Result<string[], TagServiceError>> => {
		const existingResult = await getPostTags(postId);
		if (!existingResult.ok) return existingResult;

		return try_catch_async(async () => {
			const existingSet = new Set(existingResult.value);
			const newTags = tagsToAdd.filter(tag => !existingSet.has(tag));

			if (newTags.length > 0) {
				await db.insert(tags).values(newTags.map(tag => ({ post_id: postId, tag })));
			}

			return [...existingResult.value, ...newTags];
		}, toDbError);
	};

	const removePostTag = async (postId: number, tag: string): Promise<Result<void, TagServiceError>> => {
		const [existing] = await db
			.select()
			.from(tags)
			.where(and(eq(tags.post_id, postId), eq(tags.tag, tag)))
			.limit(1);

		if (!existing) {
			return err({ kind: "not_found", resource: `tag:${tag}` });
		}

		return try_catch_async(async () => {
			await db.delete(tags).where(and(eq(tags.post_id, postId), eq(tags.tag, tag)));
		}, toDbError);
	};

	return {
		list,
		findPost,
		getPostTags,
		setPostTags,
		addPostTags,
		removePostTag,
	};
};

export type TagService = ReturnType<typeof createTagService>;
