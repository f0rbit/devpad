import type { User, UpdateUser } from "@devpad/schema";
import { db, user } from "@devpad/schema/database/server";
import { eq } from "drizzle-orm";

/**
 * Update user preferences in database
 */
export async function updateUserPreferences(userId: string, updates: UpdateUser): Promise<User> {
	const result = await db
		.update(user)
		.set(updates as any)
		.where(eq(user.id, userId))
		.returning();

	if (!result[0]) {
		throw new Error("User not found");
	}

	return result[0];
}

/**
 * Get user by ID
 */
export async function getUserById(userId: string): Promise<User | null> {
	const result = await db.select().from(user).where(eq(user.id, userId));

	return result[0] || null;
}

/**
 * Get user by GitHub ID
 */
export async function getUserByGithubId(githubId: number): Promise<User | null> {
	const result = await db.select().from(user).where(eq(user.github_id, githubId));

	return result[0] || null;
}

/**
 * Get user by email
 */
export async function getUserByEmail(email: string): Promise<User | null> {
	const result = await db.select().from(user).where(eq(user.email, email));

	return result[0] || null;
}
