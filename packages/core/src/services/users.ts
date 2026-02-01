import type { UpdateUser, User } from "@devpad/schema";
import { user } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { err, ok, type Result } from "@f0rbit/corpus";
import { eq } from "drizzle-orm";
import type { ServiceError } from "./errors.js";

export async function updateUserPreferences(db: Database, user_id: string, updates: UpdateUser): Promise<Result<User, ServiceError>> {
	const result = await db
		.update(user)
		.set(updates as any)
		.where(eq(user.id, user_id))
		.returning();

	if (!result[0]) return err({ kind: "not_found", resource: "user", id: user_id });
	return ok(result[0]);
}

export async function getUserById(db: Database, user_id: string): Promise<Result<User | null, ServiceError>> {
	const result = await db.select().from(user).where(eq(user.id, user_id));
	return ok(result[0] || null);
}

export async function getUserByGithubId(db: Database, github_id: number): Promise<Result<User | null, ServiceError>> {
	const result = await db.select().from(user).where(eq(user.github_id, github_id));
	return ok(result[0] || null);
}

export async function getUserByEmail(db: Database, email: string): Promise<Result<User | null, ServiceError>> {
	const result = await db.select().from(user).where(eq(user.email, email));
	return ok(result[0] || null);
}
