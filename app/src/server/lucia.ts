import { DrizzleSQLiteAdapter } from "@lucia-auth/adapter-drizzle";
import { Lucia } from "lucia";
import { db } from "../../database/db";
import { session, user } from "../../database/schema";

const adapter = new DrizzleSQLiteAdapter(db, session, user);

export const lucia = new Lucia(adapter, {
	sessionCookie: {
		attributes: {
			secure: import.meta.env.NODE_ENV == "production"
		}
	},
	getUserAttributes: (attributes) => {
		return {
			// attributes has the type of DatabaseUserAttributes
			github_id: attributes.github_id,
			name: attributes.name
		};
	},
	getSessionAttributes: (attributes) => {
		return {
			access_token: attributes.access_token
		}
	}
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
}
