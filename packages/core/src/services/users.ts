import { db, user } from "@devpad/schema/database";
import { eq } from "drizzle-orm";
import type { TaskView } from "@devpad/schema";

export interface UpdateUserData {
	task_view?: TaskView;
	name?: string;
	email?: string;
}

export interface User {
	id: string;
	github_id: number | null;
	name: string | null;
	email: string | null;
	email_verified: string | null;
	image_url: string | null;
	task_view: TaskView;
}

/**
 * Update user preferences in database
 */
export async function updateUserPreferences(userId: string, updates: UpdateUserData): Promise<User> {
	const updatedUsers = await db
		.update(user)
		.set({
			...updates,
		})
		.where(eq(user.id, userId))
		.returning();

	if (updatedUsers.length === 0) {
		throw new Error("User not found");
	}

	return updatedUsers[0];
}

/**
 * Get user by ID
 */
export async function getUserById(userId: string): Promise<User | null> {
	const users = await db.select().from(user).where(eq(user.id, userId)).limit(1);

	return users.length > 0 ? users[0] : null;
}

/**
 * Get user by GitHub ID
 */
export async function getUserByGithubId(githubId: number): Promise<User | null> {
	const users = await db.select().from(user).where(eq(user.github_id, githubId)).limit(1);

	return users.length > 0 ? users[0] : null;
}

/**
 * Get user by email
 */
export async function getUserByEmail(email: string): Promise<User | null> {
	const users = await db.select().from(user).where(eq(user.email, email)).limit(1);

	return users.length > 0 ? users[0] : null;
}
