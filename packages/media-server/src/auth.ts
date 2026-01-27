import { getSessionCookieName, jwtWeb, keysD1, validateSession } from "@devpad/core/auth";
import { createD1Database } from "@devpad/schema/database/d1";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { Bindings } from "./bindings";
import type { AppContext } from "./infrastructure/context";

export type AuthContext = {
	user_id: string;
	name: string | null;
	email: string | null;
	image_url: string | null;
	jwt_token?: string;
};

type AuthVariables = {
	user: { id: string; github_id: number; name: string; task_view: string } | null;
	mediaContext: AppContext;
};

const toAuthContext = (user: { id: string; name: string | null }, jwt_token?: string): AuthContext => ({
	user_id: user.id,
	name: user.name,
	email: null,
	image_url: null,
	jwt_token,
});

export const getAuth = (c: Context): AuthContext => {
	const user = c.get("user");
	if (!user) {
		throw new Error("Auth context not found. Ensure the auth middleware is applied.");
	}
	return {
		user_id: user.id,
		name: user.name,
		email: null,
		image_url: null,
	};
};

export const authMiddleware = createMiddleware<{ Bindings: Bindings; Variables: AuthVariables }>(async (c, next) => {
	const db = createD1Database(c.env.DB);

	const authHeader = c.req.header("Authorization");
	const authToken = c.req.header("Auth-Token");

	const tryJWT = async (token: string): Promise<boolean> => {
		const jwt_result = await jwtWeb.verifyJWT(c.env.JWT_SECRET, token);
		if (!jwt_result.ok) return false;
		const session_result = await validateSession(db, jwt_result.value.session_id);
		if (!session_result.ok) return false;
		c.set("auth", toAuthContext(session_result.value.user, token));
		return true;
	};

	if (authToken && (await tryJWT(authToken))) return next();

	if (authHeader?.startsWith("Bearer jwt:")) {
		const jwt_token = authHeader.slice(11);
		if (jwt_token.length > 0 && (await tryJWT(jwt_token))) return next();
	}

	const jwtCookie = getCookie(c, "devpad_jwt");
	if (jwtCookie && (await tryJWT(jwtCookie))) return next();

	const session_id = getCookie(c, getSessionCookieName());
	if (session_id) {
		const session_result = await validateSession(db, session_id);
		if (session_result.ok) {
			c.set("auth", toAuthContext(session_result.value.user));
			return next();
		}
	}

	if (authHeader?.startsWith("Bearer ") && !authHeader.startsWith("Bearer jwt:")) {
		const api_key = authHeader.slice(7);
		if (api_key.length > 0) {
			const key_result = await keysD1.getUserByApiKey(db, api_key);
			if (key_result.ok) {
				c.set("auth", toAuthContext(key_result.value));
				return next();
			}
		}
	}

	return c.json({ error: "Unauthorized", message: "Authentication required" }, 401);
});

export const optionalAuthMiddleware = createMiddleware<{ Bindings: Bindings; Variables: AuthVariables }>(async (c, next) => {
	const db = createD1Database(c.env.DB);

	const tryJWT = async (token: string): Promise<boolean> => {
		const jwt_result = await jwtWeb.verifyJWT(c.env.JWT_SECRET, token);
		if (!jwt_result.ok) return false;
		const session_result = await validateSession(db, jwt_result.value.session_id);
		if (!session_result.ok) return false;
		c.set("auth", toAuthContext(session_result.value.user, token));
		return true;
	};

	const authToken = c.req.header("Auth-Token");
	if (authToken && (await tryJWT(authToken))) return next();

	const jwtCookie = getCookie(c, "devpad_jwt");
	if (jwtCookie && (await tryJWT(jwtCookie))) return next();

	const session_id = getCookie(c, getSessionCookieName());
	if (session_id) {
		const session_result = await validateSession(db, session_id);
		if (session_result.ok) {
			c.set("auth", toAuthContext(session_result.value.user));
			return next();
		}
	}

	return next();
});
