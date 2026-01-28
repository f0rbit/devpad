import { type AccessKeyCreate, type AccessKeyUpdate, type DrizzleDB, ok, type Result, try_catch_async } from "@devpad/schema/blog";
import { api_keys } from "@devpad/schema/database/schema";
import { and, eq } from "drizzle-orm";
import { hashing } from "../utils/crypto";
import { errors, rows } from "../utils/service-helpers";

type TokenServiceError = { kind: "not_found"; resource: string } | { kind: "db_error"; message: string };

type BlogApiKeyRow = {
	id: string;
	user_id: string;
	key_hash: string;
	name: string | null;
	note: string | null;
	enabled: boolean;
	created_at: string;
};

export type SanitizedToken = {
	id: string;
	name: string | null;
	note: string | null;
	enabled: boolean;
	created_at: string;
};

export type CreatedToken = SanitizedToken & {
	token: string;
};

type Deps = {
	db: DrizzleDB;
};

const toDbError = (e: unknown): TokenServiceError => errors.db(e);

const notFound = (resource: string): TokenServiceError => errors.missing(resource);

const firstRow = <T>(r: T[], resource: string): Result<T, TokenServiceError> => rows.firstOr(r, () => notFound(resource));

const sanitize = (t: BlogApiKeyRow): SanitizedToken => ({
	id: t.id,
	name: t.name,
	note: t.note,
	enabled: t.enabled,
	created_at: t.created_at,
});

const generate = (): string => `blog_${globalThis.crypto.randomUUID()}`;

export const token = {
	sanitize,
	generate,
};

export const createTokenService = ({ db }: Deps) => {
	const list = async (userId: string): Promise<Result<SanitizedToken[], TokenServiceError>> =>
		try_catch_async(async () => {
			const tokens = await db
				.select()
				.from(api_keys)
				.where(and(eq(api_keys.user_id, userId), eq(api_keys.scope, "blog"), eq(api_keys.deleted, false)));

			return tokens.map(token.sanitize);
		}, toDbError);

	const find = async (userId: string, tokenId: string): Promise<Result<BlogApiKeyRow, TokenServiceError>> => {
		const rows = await db
			.select()
			.from(api_keys)
			.where(and(eq(api_keys.user_id, userId), eq(api_keys.id, tokenId), eq(api_keys.scope, "blog"), eq(api_keys.deleted, false)))
			.limit(1);

		return firstRow(rows as BlogApiKeyRow[], `token:${tokenId}`);
	};

	const create = async (userId: string, input: AccessKeyCreate): Promise<Result<CreatedToken, TokenServiceError>> =>
		try_catch_async(async () => {
			const plainToken = token.generate();
			const keyHash = await hashing.hash(plainToken);

			const [created] = await db
				.insert(api_keys)
				.values({
					user_id: userId,
					key_hash: keyHash,
					name: input.name,
					note: input.note ?? null,
					scope: "blog",
					enabled: true,
				})
				.returning();

			if (!created) throw new Error("Insert returned no rows");

			return {
				...token.sanitize(created as BlogApiKeyRow),
				token: plainToken,
			};
		}, toDbError);

	const update = async (userId: string, tokenId: string, input: AccessKeyUpdate): Promise<Result<SanitizedToken, TokenServiceError>> => {
		const existingResult = await find(userId, tokenId);
		if (!existingResult.ok) return existingResult;

		type UpdateFields = Partial<{
			name: string;
			note: string | null;
			enabled: boolean;
		}>;

		const updates: UpdateFields = {};
		if (input.name !== undefined) updates.name = input.name;
		if (input.note !== undefined) updates.note = input.note;
		if (input.enabled !== undefined) updates.enabled = input.enabled;

		if (Object.keys(updates).length === 0) {
			return ok(token.sanitize(existingResult.value));
		}

		return try_catch_async(async () => {
			const [updated] = await db
				.update(api_keys)
				.set(updates)
				.where(and(eq(api_keys.user_id, userId), eq(api_keys.id, tokenId), eq(api_keys.scope, "blog")))
				.returning();

			if (!updated) throw new Error("Update returned no rows");
			return token.sanitize(updated as BlogApiKeyRow);
		}, toDbError);
	};

	const remove = async (userId: string, tokenId: string): Promise<Result<void, TokenServiceError>> => {
		const existingResult = await find(userId, tokenId);
		if (!existingResult.ok) return existingResult;

		return try_catch_async(async () => {
			await db
				.update(api_keys)
				.set({ deleted: true })
				.where(and(eq(api_keys.user_id, userId), eq(api_keys.id, tokenId), eq(api_keys.scope, "blog")));
		}, toDbError);
	};

	return {
		list,
		find,
		create,
		update,
		delete: remove,
	};
};

export type TokenService = ReturnType<typeof createTokenService>;
