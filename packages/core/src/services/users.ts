import type { UpdateUser, User } from "@devpad/schema";
import { user } from "@devpad/schema/database/schema";
import { err, ok, type Result } from "@f0rbit/corpus";
import { eq } from "drizzle-orm";
import type { ServiceError } from "./errors.js";

export async function updateUserPreferences(db: any, user_id: string, updates: UpdateUser): Promise<Result<User, ServiceError>> {
	const result = await db
		.update(user)
		.set(updates as any)
		.where(eq(user.id, user_id))
		.returning();

	if (!result[0]) return err({ kind: "not_found", resource: "user", id: user_id });
	return ok(result[0]);
}

export async function getUserById(db: any, user_id: string): Promise<Result<User | null, ServiceError>> {
	const result = await db.select().from(user).where(eq(user.id, user_id));
	return ok(result[0] || null);
}

export async function getUserByGithubId(db: any, github_id: number): Promise<Result<User | null, ServiceError>> {
	const result = await db.select().from(user).where(eq(user.github_id, github_id));
	return ok(result[0] || null);
}

export async function getUserByEmail(db: any, email: string): Promise<Result<User | null, ServiceError>> {
	const result = await db.select().from(user).where(eq(user.email, email));
	return ok(result[0] || null);
}
