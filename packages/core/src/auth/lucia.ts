import type { TaskView } from "@devpad/schema";
import { db, session, user } from "@devpad/schema/database/server";
import { DrizzleSQLiteAdapter } from "@lucia-auth/adapter-drizzle";
import { Lucia } from "lucia";

// @ts-expect-error
const adapter = new DrizzleSQLiteAdapter(db, session, user);

const isProduction = Bun.env.MODE === "production";

export const lucia = new Lucia(adapter, {
	sessionCookie: {
		attributes: {
			secure: isProduction,
			sameSite: "lax",
			domain: isProduction ? ".devpad.tools" : undefined,
		},
	},
	getUserAttributes: attributes => {
		return {
			// attributes has the type of DatabaseUserAttributes
			github_id: attributes.github_id,
			name: attributes.name,
			task_view: attributes.task_view,
		};
	},
	getSessionAttributes: attributes => {
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
