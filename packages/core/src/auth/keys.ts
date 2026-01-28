import type { ApiKey, User } from "@devpad/schema";
import { api_keys, user } from "@devpad/schema/database/schema";
import { err, ok, type Result } from "@f0rbit/corpus";
import { and, eq } from "drizzle-orm";

export type KeyError = { kind: "not_found"; resource?: string } | { kind: "conflict"; resource?: string; message?: string } | { kind: "db_error"; message?: string };

type ApiKeyScope = "devpad" | "blog" | "media" | "all";

const hashKey = async (raw_key: string): Promise<string> => {
	const encoder = new TextEncoder();
	const data = encoder.encode(raw_key);
	const hashBuffer = await crypto.subtle.digest("SHA-256", data);
	return Array.from(new Uint8Array(hashBuffer))
		.map(b => b.toString(16).padStart(2, "0"))
		.join("");
};

export async function getAPIKeys(db: any, user_id: string, scope?: ApiKeyScope): Promise<Result<ApiKey[], KeyError>> {
	const conditions = [eq(api_keys.user_id, user_id), eq(api_keys.deleted, false)];
	if (scope) conditions.push(eq(api_keys.scope, scope));

	const rows = await db
		.select()
		.from(api_keys)
		.where(and(...conditions))
		.catch((e: Error) => e);

	if (rows instanceof Error) return err({ kind: "db_error", message: rows.message });

	return ok(rows as ApiKey[]);
}

export async function getUserByAPIKey(db: any, raw_key: string): Promise<Result<string, KeyError>> {
	const key_hash = await hashKey(raw_key);

	const rows = await db
		.select()
		.from(api_keys)
		.where(and(eq(api_keys.key_hash, key_hash), eq(api_keys.enabled, true), eq(api_keys.deleted, false)))
		.catch((e: Error) => e);

	if (rows instanceof Error) return err({ kind: "db_error", message: rows.message });

	if (!rows || rows.length === 0) return err({ kind: "not_found" });
	if (rows.length > 1) return err({ kind: "conflict", resource: "api_key", message: "Multiple matching keys found" });

	return ok(rows[0].user_id!);
}

export async function getUserByApiKey(db: any, raw_key: string): Promise<Result<User, KeyError>> {
	const key_result = await getUserByAPIKey(db, raw_key);
	if (!key_result.ok) return key_result;

	const users = await db
		.select()
		.from(user)
		.where(eq(user.id, key_result.value))
		.catch((e: Error) => e);

	if (users instanceof Error) return err({ kind: "db_error", message: users.message });

	if (!users || users.length === 0) return err({ kind: "not_found", resource: "user" });

	return ok(users[0] as User);
}

export type CreatedApiKey = { key: ApiKey; raw_key: string };

export async function createApiKey(db: any, user_id: string, scope: ApiKeyScope = "devpad", name?: string): Promise<Result<CreatedApiKey, KeyError>> {
	const raw_key = `devpad_${crypto.randomUUID()}`;
	const key_hash = await hashKey(raw_key);

	const rows = await db
		.insert(api_keys)
		.values({
			user_id,
			key_hash,
			name: name ?? null,
			scope,
		})
		.returning()
		.catch((e: Error) => e);

	if (rows instanceof Error) return err({ kind: "db_error", message: rows.message });

	if (!rows || rows.length === 0) return err({ kind: "db_error", message: "Insert returned no rows" });

	return ok({ key: rows[0] as ApiKey, raw_key });
}

export async function deleteApiKey(db: any, key_id: string): Promise<Result<void, KeyError>> {
	const rows = await db
		.update(api_keys)
		.set({ deleted: true })
		.where(eq(api_keys.id, key_id))
		.returning()
		.catch((e: Error) => e);

	if (rows instanceof Error) return err({ kind: "db_error", message: rows.message });

	if (!rows || rows.length === 0) return err({ kind: "not_found" });

	return ok(undefined);
}
