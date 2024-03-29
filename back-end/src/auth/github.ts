import { OAuth2RequestError, generateState } from "arctic";
import express from "express";
import { github, lucia } from "../auth/lucia";
import { parseCookies, serializeCookie } from "oslo/cookie";
import { user } from "../database/schema";
import { db } from "../database/db";
import { eq } from "drizzle-orm";

export const github_router = express.Router();

github_router.get("/", async (_, res) => {
	const state = generateState();
	const url = await github.createAuthorizationURL(state);

	const target_url = url.toString();
	const secure = import.meta.env.NODE_ENV == "production";
	const cookie = serializeCookie("github_oauth_state", state, {
		path: "/",
		secure: secure,
		httpOnly: true,
		maxAge: 60 * 10,
		sameSite: "lax"
	})

	res.appendHeader("Set-Cookie", cookie)
	res.redirect(target_url);
});

github_router.get("/callback", async (req, res) => {
	const code = req.query.code?.toString() ?? null;
	const state = req.query.state?.toString() ?? null;
	const storedState = parseCookies(req.headers.cookie ?? "").get("github_oauth_state") ?? null;
	if (!code || !state || !storedState || state !== storedState) {
		console.log(code, state, storedState);
		res.status(400).end();
		return;
	}
	try {
		const tokens = await github.validateAuthorizationCode(code);
		const githubUserResponse = await fetch("https://api.github.com/user", {
			headers: {
				Authorization: `Bearer ${tokens.accessToken}`
			}
		});
		const githubUser: GitHubUser = await githubUserResponse.json() as any;
		const existingUser = await db.selectDistinct().from(user).where(eq(user.github_id, githubUser.id));

		if (existingUser && existingUser[0]) {
			const session = await lucia.createSession(existingUser[0].id, {});
			res.appendHeader("Set-Cookie", lucia.createSessionCookie(session.id).serialize())
			return res.redirect("/");
		}

		const new_user = await db.insert(user).values({ github_id: githubUser.id, name: githubUser.login }).returning({ user_id: user.id });
		const session = await lucia.createSession(new_user[0].user_id, {});
		res.appendHeader("Set-Cookie", lucia.createSessionCookie(session.id).serialize())
		return res.redirect("/");
	} catch (e) {
		console.error(e);
		if (e instanceof OAuth2RequestError && e.message === "bad_verification_code") {
			// invalid code
			res.status(400).end();
			return;
		}
		res.status(500).end();
		return;
	}
});

interface GitHubUser {
	id: number;
	login: string;
}
