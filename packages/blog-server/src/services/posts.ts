import {
	corpusPath,
	type DrizzleDB,
	err,
	ok,
	type Post,
	type PostContent,
	type PostCorpusError,
	type PostCreate,
	type PostListParams,
	type PostRow,
	type PostsCorpus,
	type PostsResponse,
	type PostUpdate,
	pipe,
	type Result,
	try_catch_async,
	type VersionInfo,
} from "@devpad/schema/blog";
import { blog_categories as categories, blog_post_projects as postProjects, blog_posts as posts, blog_tags as tags } from "@devpad/schema/database/blog";
import { and, desc, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";
import { corpus as postsCorpus } from "../corpus/posts";
import { errors, rows } from "../utils/service-helpers";

type PostServiceError = { kind: "not_found"; resource: string } | { kind: "slug_conflict"; slug: string } | { kind: "corpus_error"; inner: PostCorpusError } | { kind: "db_error"; message: string };

type Deps = {
	db: DrizzleDB;
	corpus: PostsCorpus;
};

const toCorpusError = (e: PostCorpusError): PostServiceError => ({
	kind: "corpus_error",
	inner: e,
});

const toDbError = (e: unknown): PostServiceError => errors.db(e);

const notFound = (resource: string): PostServiceError => errors.missing(resource);

const slugConflict = (slug: string): PostServiceError => ({
	kind: "slug_conflict",
	slug,
});

const getCategoryWithDescendants = async (db: DrizzleDB, userId: string, categoryName: string): Promise<string[]> => {
	const allCategories = await db.select().from(categories).where(eq(categories.owner_id, userId));

	const collectDescendants = (name: string): string[] => {
		const children = allCategories.filter(c => c.parent === name).map(c => c.name);
		return [name, ...children.flatMap(collectDescendants)];
	};

	return collectDescendants(categoryName);
};

const fetchTagsForPosts = async (db: DrizzleDB, postIds: number[]): Promise<Map<number, string[]>> => {
	if (postIds.length === 0) return new Map();

	const tagRows = await db.select().from(tags).where(inArray(tags.post_id, postIds));

	return tagRows.reduce((acc, row) => {
		const existing = acc.get(row.post_id) ?? [];
		acc.set(row.post_id, [...existing, row.tag]);
		return acc;
	}, new Map<number, string[]>());
};

const syncTags = async (db: DrizzleDB, postId: number, tagNames: string[]): Promise<void> => {
	await db.delete(tags).where(eq(tags.post_id, postId));
	if (tagNames.length === 0) return;
	const tagInserts = tagNames.map(tag => ({ post_id: postId, tag }));
	await db.insert(tags).values(tagInserts);
};

const fetchProjectIdsForPosts = async (db: DrizzleDB, postIds: number[]): Promise<Map<number, string[]>> => {
	if (postIds.length === 0) return new Map();

	const rows = await db.select().from(postProjects).where(inArray(postProjects.post_id, postIds));

	return rows.reduce((acc, row) => {
		const existing = acc.get(row.post_id) ?? [];
		acc.set(row.post_id, [...existing, row.project_id]);
		return acc;
	}, new Map<number, string[]>());
};

const syncProjects = async (db: DrizzleDB, postId: number, projectIds: string[]): Promise<void> => {
	await db.delete(postProjects).where(eq(postProjects.post_id, postId));
	if (projectIds.length === 0) return;
	const inserts = projectIds.map(project_id => ({ post_id: postId, project_id }));
	await db.insert(postProjects).values(inserts);
};

const assemblePost = (row: PostRow, content: PostContent, tagList: string[], projectIds: string[]): Post => ({
	id: row.id,
	uuid: row.uuid,
	author_id: row.author_id,
	slug: row.slug,
	title: content.title,
	content: content.content,
	description: content.description,
	format: content.format,
	category: row.category,
	tags: tagList,
	archived: row.archived,
	publish_at: row.publish_at,
	created_at: row.created_at,
	updated_at: row.updated_at,
	project_ids: projectIds,
	corpus_version: row.corpus_version,
});

const firstRow = <T>(r: T[], resource: string): Result<T, PostServiceError> => rows.firstOr(r, () => notFound(resource));

export const createPostService = ({ db, corpus }: Deps) => {
	const checkSlugUnique = async (userId: string, slug: string, excludeId?: number): Promise<Result<void, PostServiceError>> => {
		const existing = await db
			.select({ id: posts.id })
			.from(posts)
			.where(and(eq(posts.author_id, userId), eq(posts.slug, slug)))
			.limit(1);

		if (existing.length > 0 && existing[0]?.id !== excludeId) {
			return err(slugConflict(slug));
		}
		return ok(undefined);
	};

	const create = async (userId: string, input: PostCreate): Promise<Result<Post, PostServiceError>> => {
		const slugCheck = await checkSlugUnique(userId, input.slug);
		if (!slugCheck.ok) return slugCheck;

		const uuid = crypto.randomUUID();
		const path = corpusPath(userId, uuid);
		const content: PostContent = {
			title: input.title,
			content: input.content,
			description: input.description,
			format: input.format ?? "md",
		};

		return pipe(postsCorpus.put(corpus, path, content))
			.map_err(toCorpusError)
			.flat_map(({ hash }) =>
				pipe(
					try_catch_async(async () => {
						const now = new Date();
						const publishAt = input.publish_at === undefined ? null : input.publish_at;

						const inserted = await db
							.insert(posts)
							.values({
								uuid,
								author_id: userId,
								slug: input.slug,
								corpus_version: hash,
								category: input.category ?? "root",
								archived: false,
								publish_at: publishAt,
								created_at: now,
								updated_at: now,
							})
							.returning();

						const row = inserted[0];
						if (!row) throw new Error("Insert returned no rows");

						await syncTags(db, row.id, input.tags ?? []);
						await syncProjects(db, row.id, input.project_ids ?? []);
						return assemblePost(row, content, input.tags ?? [], input.project_ids ?? []);
					}, toDbError)
				).result()
			)
			.result();
	};

	const update = async (userId: string, uuid: string, input: PostUpdate): Promise<Result<Post, PostServiceError>> => {
		const existing = await db
			.select()
			.from(posts)
			.where(and(eq(posts.author_id, userId), eq(posts.uuid, uuid)))
			.limit(1);

		const rowResult = firstRow(existing, `post:${uuid}`);
		if (!rowResult.ok) return rowResult;
		const row = rowResult.value;

		if (input.slug && input.slug !== row.slug) {
			const slugCheck = await checkSlugUnique(userId, input.slug, row.id);
			if (!slugCheck.ok) return slugCheck;
		}

		const path = corpusPath(userId, uuid);
		const currentVersion = row.corpus_version;

		const hasContentChange = input.title !== undefined || input.content !== undefined || input.description !== undefined || input.format !== undefined;

		if (!currentVersion) {
			return err(notFound(`post:${uuid}:content`));
		}

		const contentResult = await postsCorpus.get(corpus, path, currentVersion);
		if (!contentResult.ok) return err(toCorpusError(contentResult.error));
		const currentContent = contentResult.value;

		type ContentAndVersion = { content: PostContent; version: string };

		const updateContent = async (): Promise<Result<ContentAndVersion, PostServiceError>> => {
			if (!hasContentChange) {
				return ok({ content: currentContent, version: currentVersion });
			}

			const updatedContent: PostContent = {
				title: input.title ?? currentContent.title,
				content: input.content ?? currentContent.content,
				description: input.description ?? currentContent.description,
				format: input.format ?? currentContent.format,
			};

			return pipe(postsCorpus.put(corpus, path, updatedContent, currentVersion))
				.map_err(toCorpusError)
				.map(({ hash }) => ({ content: updatedContent, version: hash }))
				.result();
		};

		const contentUpdate = await updateContent();
		if (!contentUpdate.ok) return contentUpdate;
		const { content: finalContent, version: newVersion } = contentUpdate.value;

		return pipe(
			try_catch_async(async () => {
				const now = new Date();

				type PostUpdateFields = Partial<{
					slug: string;
					corpus_version: string | null;
					category: string;
					archived: boolean;
					publish_at: Date | null;
					updated_at: Date;
				}>;

				const updates: PostUpdateFields = { updated_at: now };

				if (input.slug !== undefined) updates.slug = input.slug;
				if (input.category !== undefined) updates.category = input.category;
				if (input.archived !== undefined) updates.archived = input.archived;
				if (input.publish_at !== undefined) updates.publish_at = input.publish_at;
				if (newVersion !== currentVersion) updates.corpus_version = newVersion;

				const updated = await db.update(posts).set(updates).where(eq(posts.id, row.id)).returning();

				const updatedRow = updated[0];
				if (!updatedRow) throw new Error("Update returned no rows");

				if (input.tags !== undefined) {
					await syncTags(db, updatedRow.id, input.tags);
				}

				if (input.project_ids !== undefined) {
					await syncProjects(db, updatedRow.id, input.project_ids);
				}

				const finalTags = input.tags ?? (await fetchTagsForPosts(db, [updatedRow.id])).get(updatedRow.id) ?? [];
				const finalProjectIds = input.project_ids ?? (await fetchProjectIdsForPosts(db, [updatedRow.id])).get(updatedRow.id) ?? [];

				return assemblePost(updatedRow, finalContent, finalTags, finalProjectIds);
			}, toDbError)
		).result();
	};

	const assemblePostFromRow = async (userId: string, row: PostRow): Promise<Result<Post, PostServiceError>> => {
		if (!row.corpus_version) {
			return err(notFound(`post:${row.uuid}:content`));
		}

		const path = corpusPath(userId, row.uuid);

		return pipe(postsCorpus.get(corpus, path, row.corpus_version))
			.map_err(toCorpusError)
			.map_async(async content => {
				const tagsMap = await fetchTagsForPosts(db, [row.id]);
				const projectsMap = await fetchProjectIdsForPosts(db, [row.id]);
				const tagList = tagsMap.get(row.id) ?? [];
				const projectIds = projectsMap.get(row.id) ?? [];
				return assemblePost(row, content, tagList, projectIds);
			})
			.result();
	};

	const getBySlug = async (userId: string, slug: string): Promise<Result<Post, PostServiceError>> => {
		const rows = await db
			.select()
			.from(posts)
			.where(and(eq(posts.author_id, userId), eq(posts.slug, slug)))
			.limit(1);

		const rowResult = firstRow(rows, `post:slug:${slug}`);
		if (!rowResult.ok) return rowResult;

		return assemblePostFromRow(userId, rowResult.value);
	};

	const getByUuid = async (userId: string, uuid: string): Promise<Result<Post, PostServiceError>> => {
		const rows = await db
			.select()
			.from(posts)
			.where(and(eq(posts.author_id, userId), eq(posts.uuid, uuid)))
			.limit(1);

		const rowResult = firstRow(rows, `post:${uuid}`);
		if (!rowResult.ok) return rowResult;

		return assemblePostFromRow(userId, rowResult.value);
	};

	const list = async (userId: string, params: PostListParams): Promise<Result<PostsResponse, PostServiceError>> => {
		const conditions = [eq(posts.author_id, userId)];

		if (params.category) {
			const categoryNames = await getCategoryWithDescendants(db, userId, params.category);
			conditions.push(inArray(posts.category, categoryNames));
		}

		if (params.project) {
			const projectPostIds = await db.select({ post_id: postProjects.post_id }).from(postProjects).where(eq(postProjects.project_id, params.project));

			if (projectPostIds.length === 0) {
				return ok({ posts: [], total_posts: 0, total_pages: 0, per_page: params.limit, current_page: 1 });
			}

			conditions.push(
				inArray(
					posts.id,
					projectPostIds.map(p => p.post_id)
				)
			);
		}

		if (!params.archived) {
			conditions.push(eq(posts.archived, false));
		}

		const now = new Date();
		if (params.status === "published") {
			conditions.push(lte(posts.publish_at, now));
		} else if (params.status === "scheduled") {
			conditions.push(gt(posts.publish_at, now));
		} else if (params.status === "draft") {
			conditions.push(isNull(posts.publish_at));
		}

		const whereClause = and(...conditions);

		const sortColumn = params.sort === "created" ? posts.created_at : params.sort === "published" ? posts.publish_at : posts.updated_at;

		const orderBy = desc(sortColumn);

		return pipe(
			try_catch_async(async () => {
				const countResult = await db.select({ count: sql<number>`count(*)` }).from(posts).where(whereClause);

				const totalPosts = Number(countResult[0]?.count ?? 0);

				const rows = await db.select().from(posts).where(whereClause).orderBy(orderBy).limit(params.limit).offset(params.offset);

				let filteredRows = rows;
				if (params.tag) {
					const taggedPostIds = await db.select({ post_id: tags.post_id }).from(tags).where(eq(tags.tag, params.tag));

					const taggedIds = new Set(taggedPostIds.map(t => t.post_id));
					filteredRows = rows.filter(r => taggedIds.has(r.id));
				}

				return { rows: filteredRows, totalPosts };
			}, toDbError)
		)
			.flat_map(({ rows, totalPosts }) => assemblePostsResponse(userId, rows, totalPosts, params))
			.result();
	};

	const assemblePostsResponse = async (userId: string, rows: PostRow[], totalPosts: number, params: PostListParams): Promise<Result<PostsResponse, PostServiceError>> => {
		const postIds = rows.map(r => r.id);
		const tagsMap = await fetchTagsForPosts(db, postIds);
		const projectsMap = await fetchProjectIdsForPosts(db, postIds);

		const rowsWithVersion = rows.flatMap(row => (row.corpus_version ? [{ row, version: row.corpus_version }] : []));

		const contentResults = await Promise.all(
			rowsWithVersion.map(async ({ row, version }) => {
				const path = corpusPath(userId, row.uuid);
				const contentResult = await postsCorpus.get(corpus, path, version);
				return { row, contentResult };
			})
		);

		const postsWithContent = contentResults.flatMap(({ row, contentResult }) => {
			if (!contentResult.ok) return [];
			const tagList = tagsMap.get(row.id) ?? [];
			const projectIds = projectsMap.get(row.id) ?? [];
			return [assemblePost(row, contentResult.value, tagList, projectIds)];
		});

		const totalPages = Math.ceil(totalPosts / params.limit);
		const currentPage = Math.floor(params.offset / params.limit) + 1;

		return ok({
			posts: postsWithContent,
			total_posts: totalPosts,
			total_pages: totalPages,
			per_page: params.limit,
			current_page: currentPage,
		});
	};

	const remove = async (userId: string, uuid: string): Promise<Result<void, PostServiceError>> => {
		const existing = await db
			.select()
			.from(posts)
			.where(and(eq(posts.author_id, userId), eq(posts.uuid, uuid)))
			.limit(1);

		const rowResult = firstRow(existing, `post:${uuid}`);
		if (!rowResult.ok) return rowResult;
		const row = rowResult.value;

		const path = corpusPath(userId, uuid);

		return pipe(postsCorpus.delete(corpus, path))
			.map_err(toCorpusError)
			.flat_map(() =>
				try_catch_async(async () => {
					await db.delete(tags).where(eq(tags.post_id, row.id));
					await db.delete(posts).where(eq(posts.id, row.id));
				}, toDbError)
			)
			.result();
	};

	const listVersions = async (userId: string, uuid: string): Promise<Result<VersionInfo[], PostServiceError>> => {
		const existing = await db
			.select()
			.from(posts)
			.where(and(eq(posts.author_id, userId), eq(posts.uuid, uuid)))
			.limit(1);

		if (existing.length === 0) {
			return err(notFound(`post:${uuid}`));
		}

		const path = corpusPath(userId, uuid);

		return pipe(postsCorpus.versions(corpus, path)).map_err(toCorpusError).result();
	};

	const getVersion = async (userId: string, uuid: string, hash: string): Promise<Result<PostContent, PostServiceError>> => {
		const existing = await db
			.select()
			.from(posts)
			.where(and(eq(posts.author_id, userId), eq(posts.uuid, uuid)))
			.limit(1);

		if (existing.length === 0) {
			return err(notFound(`post:${uuid}`));
		}

		const path = corpusPath(userId, uuid);

		return pipe(postsCorpus.get(corpus, path, hash))
			.map_err(toCorpusError)
			.result();
	};

	const restoreVersion = async (userId: string, uuid: string, hash: string): Promise<Result<Post, PostServiceError>> => {
		const existing = await db
			.select()
			.from(posts)
			.where(and(eq(posts.author_id, userId), eq(posts.uuid, uuid)))
			.limit(1);

		const rowResult = firstRow(existing, `post:${uuid}`);
		if (!rowResult.ok) return rowResult;
		const row = rowResult.value;

		const path = corpusPath(userId, uuid);
		const currentVersion = row.corpus_version;

		return pipe(postsCorpus.get(corpus, path, hash))
			.map_err(toCorpusError)
			.flat_map(restoredContent =>
				pipe(postsCorpus.put(corpus, path, restoredContent, currentVersion ?? undefined))
					.map_err(toCorpusError)
					.flat_map(({ hash: newHash }) =>
						pipe(
							try_catch_async(async () => {
								const now = new Date();

								const updated = await db
									.update(posts)
									.set({
										corpus_version: newHash,
										updated_at: now,
									})
									.where(eq(posts.id, row.id))
									.returning();

								const updatedRow = updated[0];
								if (!updatedRow) throw new Error("Update returned no rows");

								const tagsMap = await fetchTagsForPosts(db, [updatedRow.id]);
								const projectsMap = await fetchProjectIdsForPosts(db, [updatedRow.id]);
								const tagList = tagsMap.get(updatedRow.id) ?? [];
								const projectIds = projectsMap.get(updatedRow.id) ?? [];

								return assemblePost(updatedRow, restoredContent, tagList, projectIds);
							}, toDbError)
						).result()
					)
					.result()
			)
			.result();
	};

	return {
		create,
		update,
		getBySlug,
		getByUuid,
		list,
		delete: remove,
		listVersions,
		getVersion,
		restoreVersion,
	};
};

export type PostService = ReturnType<typeof createPostService>;
