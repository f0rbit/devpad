import { OAuth2RequestError } from "arctic";

import type { APIContext } from "astro";
import { db } from "../../../../database/db";
import { github } from "../../../server/github";
import { lucia } from "../../../server/lucia";
import { eq } from "drizzle-orm";
import { user } from "../../../../database/schema";

export async function GET(context: APIContext): Promise<Response> {
	const code = context.url.searchParams.get("code");
	const state = context.url.searchParams.get("state");
	const storedState = context.cookies.get("github_oauth_state")?.value ?? null;
	if (!code || !state || !storedState || state !== storedState) {
		console.log("no code, state or stored state");
		return new Response(null, {
			status: 400
		});
	}

	try {
		const tokens = await github.validateAuthorizationCode(code);
		const githubUserResponse = await fetch("https://api.github.com/user", {
			headers: {
				Authorization: `Bearer ${tokens.accessToken}`
			}
		});
		const githubUser: GitHubUser = await githubUserResponse.json();

		const existingUser = await db.select().from(user).where(eq(user.github_id, githubUser.id));
		// Replace this with your own DB client

		if (existingUser && existingUser[0]) {
			const session = await lucia.createSession(existingUser[0].id, { access_token: tokens.accessToken });
			const sessionCookie = lucia.createSessionCookie(session.id);
			context.cookies.set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes);
			return context.redirect("/");
		}

		const new_user = await db.insert(user).values({ github_id: githubUser.id, name: githubUser.login }).returning({ user_id: user.id });

		const session = await lucia.createSession(new_user[0].user_id, { access_token: tokens.accessToken });
		const sessionCookie = lucia.createSessionCookie(session.id);
		context.cookies.set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes);
		return context.redirect("/");
	} catch (e) {
		console.error(e);
		// the specific error message depends on the provider
		if (e instanceof OAuth2RequestError) {
			// invalid code
			return new Response(null, {
				status: 400
			});
		}
		return new Response(null, {
			status: 500
		});
	}
}

interface GitHubUser {
	id: number;
	login: string;
}
