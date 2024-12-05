import { OAuth2RequestError } from "arctic";

import type { APIContext } from "astro";
import { db } from "../../../../database/db";
import { github } from "../../../server/github";
import { lucia } from "../../../server/lucia";
import { eq } from "drizzle-orm";
import { user } from "../../../../database/schema";

export async function GET(context: APIContext): Promise<Response> {
	console.log(0);
	const code = context.url.searchParams.get("code");
	const state = context.url.searchParams.get("state");
	const storedState = context.cookies.get("github_oauth_state")?.value ?? null;
	if (!code || !state || !storedState || state !== storedState) {
		return new Response(null, { status: 400 });
	}

	try {
		console.log(1);
		const tokens = await github.validateAuthorizationCode(code);
		console.log(2)
		const githubUserResponse = await fetch("https://api.github.com/user", {
			headers: {
				Authorization: `Bearer ${tokens.accessToken}`
			}
		});
		console.log(3)
		const githubUser: GitHubUser = await githubUserResponse.json();
		console.log(4)

		const existingUser = await db.select().from(user).where(eq(user.github_id, githubUser.id));
		console.log(5)

		// Replace this with your own DB client

		if (existingUser && existingUser[0]) {
		console.log(6)
		const session = await lucia.createSession(existingUser[0].id, { access_token: tokens.accessToken });
			const sessionCookie = lucia.createSessionCookie(session.id);
		console.log(7)
		context.cookies.set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes);
			return context.redirect("/");
		}
		console.log(8)

		const new_user = await db.insert(user).values({ github_id: githubUser.id, name: githubUser.login }).returning({ user_id: user.id });
		console.log(9)

		const session = await lucia.createSession(new_user[0].user_id, { access_token: tokens.accessToken });
		console.log(10)
		const sessionCookie = lucia.createSessionCookie(session.id);
		context.cookies.set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes);
		console.log(11)

		console.log("done");
		return context.redirect("/");
	} catch (e) {
		console.error(e);
		// the specific error message depends on the provider
		if (e instanceof OAuth2RequestError) {
			// invalid code
			return new Response(null, { status: 400 });
		}
		return new Response(null, { status: 500 });
	}
}

interface GitHubUser {
	id: number;
	login: string;
}
