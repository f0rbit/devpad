import { type AccessKeyCreate, type AccessKeyRow, type AccessKeyUpdate, type DrizzleDB, ok, type Result, try_catch_async } from "@devpad/schema/blog";
import { blog_access_keys as accessKeys } from "@devpad/schema/database/blog";
import { and, eq } from "drizzle-orm";
import { hashing } from "../utils/crypto";
import { errors, rows } from "../utils/service-helpers";

type TokenServiceError = { kind: "not_found"; resource: string } | { kind: "db_error"; message: string };

export type SanitizedToken = {
	id: number;
	name: string;
	note: string | null;
	enabled: boolean;
	created_at: Date;
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

const sanitize = (t: AccessKeyRow): SanitizedToken => ({
	id: t.id,
	name: t.name,
	note: t.note,
	enabled: t.enabled,
	created_at: t.created_at,
});

const generate = (): string => globalThis.crypto.randomUUID().replace(/-/g, "") + globalThis.crypto.randomUUID().replace(/-/g, "");

export const token = {
	sanitize,
	generate,
};

export const createTokenService = ({ db }: Deps) => {
	const list = async (userId: string): Promise<Result<SanitizedToken[], TokenServiceError>> =>
		try_catch_async(async () => {
			const tokens = await db.select().from(accessKeys).where(eq(accessKeys.user_id, userId));

			return tokens.map(token.sanitize);
		}, toDbError);

	const find = async (userId: string, tokenId: number): Promise<Result<AccessKeyRow, TokenServiceError>> => {
		const rows = await db
			.select()
			.from(accessKeys)
			.where(and(eq(accessKeys.user_id, userId), eq(accessKeys.id, tokenId)))
			.limit(1);

		return firstRow(rows, `token:${tokenId}`);
	};

	const create = async (userId: string, input: AccessKeyCreate): Promise<Result<CreatedToken, TokenServiceError>> =>
		try_catch_async(async () => {
			const plainToken = token.generate();
			const keyHash = await hashing.hash(plainToken);

			const [created] = await db
				.insert(accessKeys)
				.values({
					user_id: userId,
					key_hash: keyHash,
					name: input.name,
					note: input.note ?? null,
					enabled: true,
				})
				.returning();

			if (!created) throw new Error("Insert returned no rows");

			return {
				...token.sanitize(created),
				token: plainToken,
			};
		}, toDbError);

	const update = async (userId: string, tokenId: number, input: AccessKeyUpdate): Promise<Result<SanitizedToken, TokenServiceError>> => {
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
				.update(accessKeys)
				.set(updates)
				.where(and(eq(accessKeys.user_id, userId), eq(accessKeys.id, tokenId)))
				.returning();

			if (!updated) throw new Error("Update returned no rows");
			return token.sanitize(updated);
		}, toDbError);
	};

	const remove = async (userId: string, tokenId: number): Promise<Result<void, TokenServiceError>> => {
		const existingResult = await find(userId, tokenId);
		if (!existingResult.ok) return existingResult;

		return try_catch_async(async () => {
			await db.delete(accessKeys).where(and(eq(accessKeys.user_id, userId), eq(accessKeys.id, tokenId)));
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
