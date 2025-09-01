import { api_key, db, user } from "@devpad/schema/database";
import type { APIContext } from "astro";
import type { ApiKey, User } from "@devpad/schema";
import { eq } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";

export async function getAPIKeys(user_id: string) {
	return await db.select().from(api_key).where(eq(api_key.owner_id, user_id));
}

export async function getUserByAPIKey(key: string): Promise<{ user_id: string; error: null } | { user_id: null; error: string }> {
	const user = await db.select().from(api_key).where(eq(api_key.hash, key));
	if (!user || user.length === 0) {
		return { user_id: null, error: "Invalid API key" };
	}
	if (user.length > 1) {
		return { user_id: null, error: "Multiple users with same API key" };
	}
	return { user_id: user[0].owner_id!, error: null };
}

export async function getAuthedUser(request: APIContext): Promise<{ user_id: string; error: null } | { user_id: null; error: string }> {
	// take the auth key from the headers
	// will be Authorization: Bearer <auth_key>
	const auth_key = request.request.headers.get("Authorization")?.split(" ")?.[1];
	if (!auth_key) {
		return { user_id: null, error: "No auth key provided" };
	}

	// check if the auth key is valid
	const found = await getUserByAPIKey(auth_key);
	return found;
}

// Alias for interface compatibility
export async function getUserByApiKey(apiKey: string): Promise<{ user: User | null; error: string | null }> {
	try {
		const result = await getUserByAPIKey(apiKey);
		if (result.error) {
			return { user: null, error: result.error };
		}

		// Get full user details
		const users = await db.select().from(user).where(eq(user.id, result.user_id!));
		if (users.length === 0) {
			return { user: null, error: "User not found" };
		}

		return { user: users[0] as User, error: null };
	} catch (error) {
		return { user: null, error: `Failed to get user: ${error}` };
	}
}

export async function createApiKey(userId: string, name: string): Promise<{ key: ApiKey; error: string | null }> {
	try {
		const keyHash = createId(); // This would normally be properly hashed

		const result = await db
			.insert(api_key)
			.values({
				owner_id: userId,
				hash: keyHash,
			})
			.returning();

		if (result.length === 0) {
			return { key: {} as ApiKey, error: "Failed to create API key" };
		}

		return { key: result[0] as ApiKey, error: null };
	} catch (error) {
		return { key: {} as ApiKey, error: `Failed to create API key: ${error}` };
	}
}

export async function deleteApiKey(keyId: string): Promise<{ success: boolean; error: string | null }> {
	try {
		const result = await db.delete(api_key).where(eq(api_key.id, keyId)).returning();
		return { success: result.length > 0, error: null };
	} catch (error) {
		return { success: false, error: `Failed to delete API key: ${error}` };
	}
}
