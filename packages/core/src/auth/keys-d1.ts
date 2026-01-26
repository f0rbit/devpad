import type { ApiKey, User } from "@devpad/schema";
import { api_key, user } from "@devpad/schema/database/schema";
import { err, ok, type Result } from "@f0rbit/corpus";
import { eq } from "drizzle-orm";

export type KeyError = { kind: "not_found" } | { kind: "multiple_matches" } | { kind: "user_not_found" } | { kind: "database_error"; message: string };

export async function getAPIKeys(db: any, user_id: string): Promise<Result<ApiKey[], KeyError>> {
	const rows = await db
		.select()
		.from(api_key)
		.where(eq(api_key.owner_id, user_id))
		.catch((e: Error) => e);

	if (rows instanceof Error) return err({ kind: "database_error", message: rows.message });

	return ok(rows as ApiKey[]);
}

export async function getUserByAPIKey(db: any, key: string): Promise<Result<string, KeyError>> {
	const rows = await db
		.select()
		.from(api_key)
		.where(eq(api_key.hash, key))
		.catch((e: Error) => e);

	if (rows instanceof Error) return err({ kind: "database_error", message: rows.message });

	if (!rows || rows.length === 0) return err({ kind: "not_found" });
	if (rows.length > 1) return err({ kind: "multiple_matches" });

	return ok(rows[0].owner_id!);
}

export async function getUserByApiKey(db: any, key: string): Promise<Result<User, KeyError>> {
	const key_result = await getUserByAPIKey(db, key);
	if (!key_result.ok) return key_result;

	const users = await db
		.select()
		.from(user)
		.where(eq(user.id, key_result.value))
		.catch((e: Error) => e);

	if (users instanceof Error) return err({ kind: "database_error", message: users.message });

	if (!users || users.length === 0) return err({ kind: "user_not_found" });

	return ok(users[0] as User);
}

export async function createApiKey(db: any, user_id: string): Promise<Result<ApiKey, KeyError>> {
	const key_hash = crypto.randomUUID();

	const rows = await db
		.insert(api_key)
		.values({
			owner_id: user_id,
			hash: key_hash,
		})
		.returning()
		.catch((e: Error) => e);

	if (rows instanceof Error) return err({ kind: "database_error", message: rows.message });

	if (!rows || rows.length === 0) return err({ kind: "database_error", message: "Insert returned no rows" });

	return ok(rows[0] as ApiKey);
}

export async function deleteApiKey(db: any, key_id: string): Promise<Result<void, KeyError>> {
	const rows = await db
		.delete(api_key)
		.where(eq(api_key.id, key_id))
		.returning()
		.catch((e: Error) => e);

	if (rows instanceof Error) return err({ kind: "database_error", message: rows.message });

	if (!rows || rows.length === 0) return err({ kind: "not_found" });

	return ok(undefined);
}
