import { createBlankSessionCookie, createSessionCookie, getSessionCookieName, keys, validateSession } from "@devpad/core/auth";
import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { AppContext } from "../bindings.js";
import { cookieConfig } from "../utils/cookies.js";

const setNullAuth = (c: any) => {
	c.set("user", null);
	c.set("session", null);
	c.set("auth_channel", "user");
};

export const authMiddleware = createMiddleware<AppContext>(async (c, next) => {
	const db = c.get("db");
	const config = c.get("config");

	const auth_header = c.req.header("Authorization");
	if (auth_header?.startsWith("Bearer ")) {
		const token = auth_header.slice(7);

		const key_result = await keys.getUserByApiKey(db, token);
		if (key_result.ok) {
			c.set("user", {
				id: key_result.value.id,
				github_id: key_result.value.github_id!,
				name: key_result.value.name!,
				task_view: key_result.value.task_view as "list" | "grid",
			});
			c.set("session", null);
			c.set("auth_channel", "api");
			return next();
		}
	}

	const session_id = getCookie(c, getSessionCookieName());
	if (session_id) {
		const session_result = await validateSession(db, session_id);
		if (session_result.ok) {
			const { user: session_user, session: session_data } = session_result.value;
			c.set("user", {
				id: session_user.id,
				github_id: session_user.github_id!,
				name: session_user.name!,
				task_view: session_user.task_view,
			});
			c.set("session", session_data);
			c.set("auth_channel", "user");

			if (session_data.fresh) {
				c.header("Set-Cookie", createSessionCookie(session_data.id, cookieConfig(config.environment)));
			}
			return next();
		}

		c.header("Set-Cookie", createBlankSessionCookie(cookieConfig(config.environment)));
	}

	setNullAuth(c);
	return next();
});

export const requireAuth = createMiddleware<AppContext>(async (c, next) => {
	const user = c.get("user");
	if (!user) return c.json({ error: "Unauthorized" }, 401);
	return next();
});
