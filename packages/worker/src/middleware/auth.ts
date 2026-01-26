import { createBlankSessionCookie, createSessionCookie, getSessionCookieName, jwtWeb, keysD1, validateSession } from "@devpad/core/auth";
import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { AppContext } from "../bindings.js";

const setNullAuth = (c: any) => {
	c.set("user", null);
	c.set("session", null);
};

const cookieConfig = (env: { ENVIRONMENT: string }) => {
	const is_production = env.ENVIRONMENT === "production";
	return {
		secure: is_production,
		domain: is_production ? ".devpad.tools" : undefined,
		same_site: "lax" as const,
	};
};

export const authMiddleware = createMiddleware<AppContext>(async (c, next) => {
	const db = c.get("db");
	const env = c.env;

	const auth_header = c.req.header("Authorization");
	if (auth_header?.startsWith("Bearer ")) {
		const token = auth_header.slice(7);

		if (token.startsWith("jwt:")) {
			const jwt_token = token.slice(4);
			const jwt_result = await jwtWeb.verifyJWT(env.JWT_SECRET, jwt_token);
			if (jwt_result.ok) {
				const session_result = await validateSession(db, jwt_result.value.session_id);
				if (session_result.ok) {
					c.set("user", {
						id: session_result.value.user.id,
						github_id: session_result.value.user.github_id!,
						name: session_result.value.user.name!,
						task_view: session_result.value.user.task_view,
					});
					c.set("session", session_result.value.session);
					return next();
				}
			}
		}

		const key_result = await keysD1.getUserByApiKey(db, token);
		if (key_result.ok) {
			c.set("user", {
				id: key_result.value.id,
				github_id: key_result.value.github_id!,
				name: key_result.value.name!,
				task_view: key_result.value.task_view as "list" | "grid",
			});
			c.set("session", null);
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

			if (session_data.fresh) {
				c.header("Set-Cookie", createSessionCookie(session_data.id, cookieConfig(env)));
			}
			return next();
		}

		c.header("Set-Cookie", createBlankSessionCookie(cookieConfig(env)));
	}

	setNullAuth(c);
	return next();
});

export const requireAuth = createMiddleware<AppContext>(async (c, next) => {
	const user = c.get("user");
	if (!user) return c.json({ error: "Unauthorized" }, 401);
	return next();
});
