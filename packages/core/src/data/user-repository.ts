import type { TaskView } from "@devpad/schema";
import { db, user } from "@devpad/schema/database/server";
import { eq } from "drizzle-orm";
import { BaseRepository } from "./base-repository";

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

export class UserRepository extends BaseRepository<typeof user, User, UpdateUserData> {
	constructor() {
		super(user);
	}

	async getUserById(userId: string): Promise<User | null> {
		return this.findById(userId);
	}

	async getUserByGithubId(githubId: number): Promise<User | null> {
		try {
			const users = await db.select().from(user).where(eq(user.github_id, githubId)).limit(1);
			return users.length > 0 ? users[0] : null;
		} catch (error) {
			console.error("Error getting user by GitHub ID:", error);
			return null;
		}
	}

	async getUserByEmail(email: string): Promise<User | null> {
		try {
			const users = await db.select().from(user).where(eq(user.email, email)).limit(1);
			return users.length > 0 ? users[0] : null;
		} catch (error) {
			console.error("Error getting user by email:", error);
			return null;
		}
	}

	async updateUserPreferences(userId: string, updates: UpdateUserData): Promise<User> {
		const result = await this.updateById(userId, updates);
		if (!result) {
			throw new Error("User not found");
		}
		return result;
	}
}

export const userRepository = new UserRepository();
