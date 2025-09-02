import { getUserById } from "@devpad/core";
import { lucia } from "@devpad/core/auth";
import { getUserByAPIKey } from "@devpad/core/auth/keys";
import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { verifyRequestOrigin } from "lucia";

export interface AuthVariables {
	user: {
		id: string;
		github_id: number;
		name: string;
		task_view: "list" | "grid";
	} | null;
	session: any | null;
}

export type AuthContext = {
	Variables: AuthVariables;
};

export const authMiddleware = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
	// CSRF protection for non-GET requests (skip in test environment)
	const isTest = process.env.NODE_ENV === "test";
	if (c.req.method !== "GET" && !isTest) {
		const originHeader = c.req.header("Origin");
		const hostHeader = c.req.header("Host");

		if (!originHeader || !hostHeader || !verifyRequestOrigin(originHeader, [hostHeader])) {
			console.error("Invalid origin", { originHeader, hostHeader, isTest, nodeEnv: process.env.NODE_ENV });
			console.log("CSRF check:", { method: c.req.method, nodeEnv: process.env.NODE_ENV, isTest: process.env.NODE_ENV === "test" });
			return c.json({ error: "Invalid origin" }, 403);
		}
	}

	// Check for API key authentication first
	const authHeader = c.req.header("Authorization");
	if (authHeader?.startsWith("Bearer ")) {
		const apiKey = authHeader.split(" ")[1];
		if (apiKey) {
			const { user_id, error } = await getUserByAPIKey(apiKey);

			if (!error && user_id) {
				// Get full user data for API key auth
				const fullUser = await getUserById(user_id);
				if (fullUser) {
					c.set("user", fullUser as any);
				} else {
					c.set("user", null);
				}
				c.set("session", null);
				return next();
			}
		}
	}

	// Fall back to session-based authentication
	const sessionId = getCookie(c, lucia.sessionCookieName) ?? null;
	if (!sessionId) {
		c.set("user", null);
		c.set("session", null);
		return next();
	}

	const { session, user } = await lucia.validateSession(sessionId);

	// Handle session refresh
	if (session?.fresh) {
		const sessionCookie = lucia.createSessionCookie(session.id);
		c.header(
			"Set-Cookie",
			`${sessionCookie.name}=${sessionCookie.value}; ${Object.entries(sessionCookie.attributes)
				.map(([k, v]) => `${k}=${v}`)
				.join("; ")}`
		);
	}

	if (!session) {
		const sessionCookie = lucia.createBlankSessionCookie();
		c.header(
			"Set-Cookie",
			`${sessionCookie.name}=${sessionCookie.value}; ${Object.entries(sessionCookie.attributes)
				.map(([k, v]) => `${k}=${v}`)
				.join("; ")}`
		);
	}

	c.set("user", user);
	c.set("session", session);

	return next();
});

export const requireAuth = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
	const user = c.get("user");
	if (!user) {
		return c.json({ error: "Unauthorized" }, 401);
	}
	return next();
});
