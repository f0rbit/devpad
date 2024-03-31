import { Lucia } from "lucia";
import { DrizzleSQLiteAdapter } from "@lucia-auth/adapter-drizzle";
import { db } from "../database/db";
import { session, user } from "../database/schema";
import { GitHub } from "arctic";
import express from "express";
import { github_router } from "./github";

const adapter = new DrizzleSQLiteAdapter(db, session, user); // your adapter

export const lucia = new Lucia(adapter, {
	sessionCookie: {
		attributes: {
			// set to `true` when using HTTPS
			secure: false
		}
	},
	getUserAttributes: (attributes) => {
		return {
			githubId: attributes.github_id,
			username: attributes.name
		};
	}
});

export const github = new GitHub(
	import.meta.env.GITHUB_CLIENT_ID!,
	import.meta.env.GITHUB_CLIENT_SECRET!
);

declare module "lucia" {
	interface Register {
		Lucia: typeof lucia;
		DatabaseUserAttributes: DatabaseUserAttributes;
	}
}
interface DatabaseUserAttributes {
	name: string,
	github_id: number
}

export const auth_router = express.Router();
auth_router.use("/github", github_router);

auth_router.get("/session", (_, res) => {
	res.json({ session: res.locals.session, user: res.locals.user });	
});
