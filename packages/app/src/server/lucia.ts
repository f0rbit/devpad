import { DrizzleSQLiteAdapter } from "@lucia-auth/adapter-drizzle";
import { Lucia } from "lucia";
import { db } from "../../database/db";
import { session, user } from "../../database/schema";
import type { TaskView } from "./types";

// @ts-ignore
const adapter = new DrizzleSQLiteAdapter(db, session, user);

export const lucia = new Lucia(adapter, {
	sessionCookie: {
		attributes: {
			secure: Bun.env.MODE == "production",
		},
	},
	getUserAttributes: (attributes) => {
		return {
			// attributes has the type of DatabaseUserAttributes
			github_id: attributes.github_id,
			name: attributes.name,
			task_view: attributes.task_view,
		};
	},
	getSessionAttributes: (attributes) => {
		return {
			access_token: attributes.access_token,
		};
	},
});

declare module "lucia" {
	interface Register {
		Lucia: typeof lucia;
		DatabaseUserAttributes: DatabaseUserAttributes;
		DatabaseSessionAttributes: { access_token: string };
	}
}

interface DatabaseUserAttributes {
	github_id: number;
	name: string;
	task_view: TaskView;
}
