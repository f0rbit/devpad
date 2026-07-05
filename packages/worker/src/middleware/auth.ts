import {
	createBlankSessionCookie,
	createSessionCookie,
	getSessionCookieName,
	keys,
	validateSession,
} from "@devpad/core/auth";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { AppContext } from "../bindings.js";
import { cookieConfig } from "../utils/cookies.js";

const setNullAuth = (c: Context<AppContext>) => {
	c.set("user", null);
	c.set("session", null);
	c.set("auth_channel", "user");
	c.set("api_key_scope", null);
};

export const authMiddleware = createMiddleware<AppContext>(async (c, next) => {
	const db = c.get("db");
	const config = c.get("config");

	const auth_header = c.req.header("Authorization");
	if (auth_header?.startsWith("Bearer ")) {
		const token = auth_header.slice(7);

		const key_result = await keys.getUserAndScopeByApiKey(db, token);
		if (key_result.ok && key_result.value.user.github_id !== null && key_result.value.user.name !== null) {
			c.set("user", {
				id: key_result.value.user.id,
				github_id: key_result.value.user.github_id,
				name: key_result.value.user.name,
				task_view: key_result.value.user.task_view,
			});
			c.set("session", null);
			c.set("auth_channel", "api");
			c.set("api_key_scope", key_result.value.scope);
			return next();
		}
	}

	const session_id = getCookie(c, getSessionCookieName());
	if (session_id) {
		const session_result = await validateSession(db, session_id);
		if (session_result.ok && session_result.value.user.github_id !== null && session_result.value.user.name !== null) {
			const { user: session_user, session: session_data } = session_result.value;
			c.set("user", {
				id: session_user.id,
				github_id: session_user.github_id,
				name: session_user.name,
				task_view: session_user.task_view,
			});
			c.set("session", session_data);
			c.set("auth_channel", "user");
			c.set("api_key_scope", null);

			if (session_data.fresh) {
				c.header("Set-Cookie", createSessionCookie(session_data.id, cookieConfig(config.environment)));
			}
			return next();
		}
		// Falls through here both when the session lookup failed AND when it
		// succeeded but the user record is missing github_id/name (a data
		// integrity gap) — either way we treat it as unauthenticated rather
		// than asserting past nullable DB columns.
		c.header("Set-Cookie", createBlankSessionCookie(cookieConfig(config.environment)));
	}

	c.get("log")?.warning("auth_failed", { path: c.req.path, has_session: Boolean(c.req.header("cookie")) });

	setNullAuth(c);
	return next();
});

export const requireAuth = createMiddleware<AppContext>(async (c, next) => {
	const user = c.get("user");
	if (!user) return c.json({ error: "Unauthorized" }, 401);
	return next();
});
