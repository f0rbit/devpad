import { createBlankSessionCookie, createSessionCookie, getSessionCookieName, invalidateSession, jwtWeb, oauthD1, validateSession } from "@devpad/core/auth";
import { usersD1 } from "@devpad/core/services";
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { AppContext } from "../bindings.js";

const ALLOWED_REDIRECT_PATTERNS = [
	/^https:\/\/[a-z0-9.-]+\.pages\.dev$/,
	/^https:\/\/[a-z0-9.-]+\.workers\.dev$/,
	/^https:\/\/blog\.devpad\.tools$/,
	/^https:\/\/devpad\.tools$/,
	/^https:\/\/staging\.devpad\.tools$/,
	/^http:\/\/localhost:\d+$/,
];

const isAllowedRedirectUrl = (url: string): boolean => {
	try {
		const parsed = new URL(url);
		return ALLOWED_REDIRECT_PATTERNS.some(pattern => pattern.test(parsed.origin));
	} catch {
		return false;
	}
};

const cookieConfig = (env: { ENVIRONMENT: string }) => {
	const is_production = env.ENVIRONMENT === "production";
	return {
		secure: is_production,
		domain: is_production ? ".devpad.tools" : undefined,
		same_site: "lax" as const,
	};
};

const app = new Hono<AppContext>();

app.get("/login", async c => {
	const env = c.env;
	const return_to = c.req.query("return_to");
	const mode = c.req.query("mode") as "jwt" | "session" | undefined;

	const oauth_env = {
		GITHUB_CLIENT_ID: env.GITHUB_CLIENT_ID,
		GITHUB_CLIENT_SECRET: env.GITHUB_CLIENT_SECRET,
		JWT_SECRET: env.JWT_SECRET,
	};

	const result = oauthD1.createGitHubAuthUrl(oauth_env, {
		return_to: return_to && isAllowedRedirectUrl(return_to) ? return_to : undefined,
		mode,
	});

	if (!result.ok) return c.json({ error: "Failed to initiate GitHub OAuth" }, 500);

	const { url, state } = result.value;

	setCookie(c, "github_oauth_state", state, {
		path: "/",
		secure: env.ENVIRONMENT === "production",
		httpOnly: true,
		maxAge: 60 * 10,
		sameSite: "Lax",
	});

	return c.redirect(url);
});

app.get("/callback/github", async c => {
	const env = c.env;
	const db = c.get("db");
	const code = c.req.query("code");
	const state = c.req.query("state");
	const stored_state = getCookie(c, "github_oauth_state");

	if (!code || !state || !stored_state || state !== stored_state) {
		return c.json({ error: "Invalid OAuth parameters" }, 400);
	}

	const oauth_env = {
		GITHUB_CLIENT_ID: env.GITHUB_CLIENT_ID,
		GITHUB_CLIENT_SECRET: env.GITHUB_CLIENT_SECRET,
		JWT_SECRET: env.JWT_SECRET,
	};

	const callback_result = await oauthD1.handleGitHubCallback(db, oauth_env, code, state, stored_state);
	if (!callback_result.ok) return c.json({ error: "OAuth callback failed" }, 500);

	const { user: oauth_user, accessToken, sessionId } = callback_result.value;

	const jwt_result = await jwtWeb.generateJWT(env.JWT_SECRET, {
		user_id: oauth_user.id,
		session_id: sessionId,
	});

	const token = jwt_result.ok ? jwt_result.value : null;

	const config = cookieConfig(env);
	c.header("Set-Cookie", createSessionCookie(sessionId, config));

	setCookie(c, "github_oauth_state", "", {
		path: "/",
		maxAge: 0,
	});

	const decoded_state = oauthD1.decodeOAuthState(state);

	if (decoded_state.ok && decoded_state.value.mode === "jwt" && decoded_state.value.return_to && token) {
		if (isAllowedRedirectUrl(decoded_state.value.return_to)) {
			return c.redirect(`${decoded_state.value.return_to}?token=${token}`);
		}
	}

	const frontend_url = env.FRONTEND_URL || "http://localhost:3000";

	if (token) {
		return c.redirect(`${frontend_url}/auth/callback?token=${token}`);
	}

	return c.redirect(`${frontend_url}/project`);
});

app.get("/logout", async c => {
	const db = c.get("db");
	const env = c.env;
	const session = c.get("session");

	if (session) {
		await invalidateSession(db, session.id);
		c.header("Set-Cookie", createBlankSessionCookie(cookieConfig(env)));
	}

	const frontend_url = env.FRONTEND_URL || "http://localhost:3000";
	return c.redirect(`${frontend_url}/auth/logout`);
});

app.get("/session", async c => {
	const db = c.get("db");
	const user = c.get("user");
	const session = c.get("session");

	if (!user || !session) {
		return c.json({ authenticated: false, user: null, session: null });
	}

	const full_user_result = await usersD1.getUserById(db, user.id);
	const full_user = full_user_result.ok ? full_user_result.value : null;

	return c.json({
		authenticated: true,
		user: full_user
			? {
					id: full_user.id,
					name: full_user.name,
					email: full_user.email,
					github_id: full_user.github_id,
					image_url: full_user.image_url,
					task_view: full_user.task_view,
				}
			: {
					id: user.id,
					name: user.name,
					github_id: user.github_id,
					task_view: user.task_view,
				},
		session: { id: session.id },
	});
});

app.get("/verify", async c => {
	const db = c.get("db");
	const user = c.get("user");
	const session = c.get("session");

	if (user && !session) {
		const full_user_result = await usersD1.getUserById(db, user.id);
		const full_user = full_user_result.ok ? full_user_result.value : null;

		return c.json({
			authenticated: true,
			user: full_user
				? {
						id: full_user.id,
						name: full_user.name,
						email: full_user.email,
						github_id: full_user.github_id,
						image_url: full_user.image_url,
						task_view: full_user.task_view,
					}
				: {
						id: user.id,
						name: user.name,
						github_id: user.github_id,
						task_view: user.task_view,
					},
		});
	}

	if (!user || !session) {
		return c.json({ authenticated: false, user: null }, 200);
	}

	const full_user_result = await usersD1.getUserById(db, user.id);
	const full_user = full_user_result.ok ? full_user_result.value : null;

	return c.json({
		authenticated: true,
		user: full_user
			? {
					id: full_user.id,
					name: full_user.name,
					email: full_user.email,
					github_id: full_user.github_id,
					image_url: full_user.image_url,
					task_view: full_user.task_view,
				}
			: {
					id: user.id,
					name: user.name,
					github_id: user.github_id,
					task_view: user.task_view,
				},
	});
});

export default app;
