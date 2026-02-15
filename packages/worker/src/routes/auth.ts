import { createBlankSessionCookie, createSessionCookie, invalidateSession, oauth } from "@devpad/core/auth";
import { users } from "@devpad/core/services";
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { AppContext } from "../bindings.js";
import { cookieConfig } from "../utils/cookies.js";
import { githubOAuthConfig } from "./v1/media/auth.js";
import { oauth as mediaOAuth } from "./v1/media/oauth-helpers.js";

const ALLOWED_REDIRECT_PATTERNS = [/^https:\/\/[a-z0-9.-]+\.pages\.dev$/, /^https:\/\/[a-z0-9.-]+\.workers\.dev$/, /^https:\/\/([a-z0-9-]+\.)?devpad\.tools$/, /^http:\/\/localhost:\d+$/];

const isAllowedRedirectUrl = (url: string): boolean => {
	try {
		const parsed = new URL(url);
		return ALLOWED_REDIRECT_PATTERNS.some(pattern => pattern.test(parsed.origin));
	} catch {
		return false;
	}
};

const app = new Hono<AppContext>();

app.get("/login", async c => {
	const config = c.get("config");
	const oauth_secrets = c.get("oauth_secrets");
	let return_to = c.req.query("return_to");

	if (!return_to) {
		const referer = c.req.header("Referer");
		if (referer) {
			const referer_url = new URL(referer);
			return_to = referer_url.origin;
		}
	}

	const oauth_env = {
		GITHUB_CLIENT_ID: oauth_secrets.github_client_id,
		GITHUB_CLIENT_SECRET: oauth_secrets.github_client_secret,
	};

	const result = oauth.createGitHubAuthUrl(oauth_env, {
		return_to: return_to && isAllowedRedirectUrl(return_to) ? return_to : undefined,
	});

	if (!result.ok) return c.json({ error: "Failed to initiate GitHub OAuth" }, 500);

	const { url, state } = result.value;

	setCookie(c, "github_oauth_state", state, {
		path: "/",
		secure: config.environment !== "development",
		httpOnly: true,
		maxAge: 60 * 10,
		sameSite: "Lax",
	});

	return c.redirect(url);
});

app.get("/callback/github", async c => {
	const code = c.req.query("code");
	const state = c.req.query("state");

	if (!code || !state) {
		return c.json({ error: "Invalid OAuth parameters" }, 400);
	}

	let decoded: Record<string, unknown>;
	try {
		decoded = JSON.parse(atob(state.replace(/-/g, "+").replace(/_/g, "/")));
	} catch {
		return c.json({ error: "Invalid OAuth state" }, 400);
	}

	if (decoded.profile_id) {
		const handler = mediaOAuth.callback(githubOAuthConfig);
		return handler(c);
	}

	const config = c.get("config");
	const oauth_secrets = c.get("oauth_secrets");
	const db = c.get("db");
	const stored_state = getCookie(c, "github_oauth_state");

	if (!stored_state || state !== stored_state) {
		return c.json({ error: "Invalid OAuth parameters" }, 400);
	}

	const oauth_env = {
		GITHUB_CLIENT_ID: oauth_secrets.github_client_id,
		GITHUB_CLIENT_SECRET: oauth_secrets.github_client_secret,
	};

	const callback_result = await oauth.handleGitHubCallback(db, oauth_env, code, state, stored_state);
	if (!callback_result.ok) return c.json({ error: "OAuth callback failed", detail: callback_result.error }, 500);

	const { sessionId } = callback_result.value;
	console.log(`[auth/callback] session created: ${sessionId.substring(0, 8)}...`);

	const cookie_config = cookieConfig(config.environment);
	console.log(`[auth/callback] cookie config: ${JSON.stringify(cookie_config)}`);
	c.header("Set-Cookie", createSessionCookie(sessionId, cookie_config));

	setCookie(c, "github_oauth_state", "", {
		path: "/",
		maxAge: 0,
	});

	const decoded_state = oauth.decodeOAuthState(state);
	const return_to = decoded_state.ok ? decoded_state.value.return_to : undefined;
	const frontend_url = config.frontend_url || "http://localhost:3000";

	if (config.environment === "development") {
		const redirect_url = return_to || frontend_url;
		console.log(`[auth/callback] redirecting to: ${redirect_url}/project?auth_session=${sessionId}`);
		return c.redirect(`${redirect_url}/project?auth_session=${sessionId}`);
	}

	const return_url = return_to ? new URL(return_to) : null;
	if (return_url && isAllowedRedirectUrl(return_to!) && return_url.pathname !== "/") {
		console.log(`[auth/callback] redirecting to: ${return_to}`);
		return c.redirect(return_to!);
	}

	console.log(`[auth/callback] redirecting to: ${frontend_url}/project`);
	return c.redirect(`${frontend_url}/project`);
});

app.get("/logout", async c => {
	const db = c.get("db");
	const config = c.get("config");
	const session = c.get("session");

	if (session) {
		await invalidateSession(db, session.id);
		c.header("Set-Cookie", createBlankSessionCookie(cookieConfig(config.environment)));
	}

	const referer = c.req.header("Referer");
	if (referer) {
		const referer_origin = new URL(referer).origin;
		if (isAllowedRedirectUrl(referer_origin)) {
			return c.redirect(referer_origin);
		}
	}

	const frontend_url = config.frontend_url || "http://localhost:3000";
	return c.redirect(frontend_url);
});

app.get("/session", async c => {
	const db = c.get("db");
	const user = c.get("user");
	const session = c.get("session");

	if (!user || !session) {
		return c.json({ authenticated: false, user: null, session: null });
	}

	const full_user_result = await users.getUserById(db, user.id);
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

export default app;
