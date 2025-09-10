import { getUserById, log } from "@devpad/core";
import { lucia } from "@devpad/core/auth";
import { getUserByAPIKey } from "@devpad/core/auth/keys";
import { verifyJWT } from "@devpad/core/auth/jwt";
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
	log.auth(`Processing ${c.req.method} ${c.req.path}`);

	// CSRF protection for non-GET requests (skip in development and test)
	const isDev = process.env.NODE_ENV === "development";
	const isTest = process.env.NODE_ENV === "test";
	if (c.req.method !== "GET" && !isTest && !isDev) {
		const originHeader = c.req.header("Origin");
		const hostHeader = c.req.header("Host");

		log.auth(`CSRF check:`, { originHeader, hostHeader, isDev, isTest });
		if (!originHeader || !hostHeader || !verifyRequestOrigin(originHeader, [hostHeader])) {
			log.error("Invalid origin", { originHeader, hostHeader, isDev, isTest, nodeEnv: process.env.NODE_ENV });
			return c.json({ error: "Invalid origin" }, 403);
		}
	}

	// Check for API key authentication first
	const authHeader = c.req.header("Authorization");
	log.auth("🔑 Auth header:", authHeader ? `Bearer ${authHeader.split(" ")[1]?.substring(0, 10)}...` : "none");

	if (authHeader?.startsWith("Bearer ")) {
		const token = authHeader.split(" ")[1];
		if (token) {
			// Check if token has JWT prefix
			if (token.startsWith("jwt:")) {
				log.auth("🎟️  JWT token detected");
				// JWT token
				const jwtToken = token.substring(4);
				const jwtPayload = verifyJWT(jwtToken);

				log.auth("🔍 JWT verification result:", jwtPayload ? "valid" : "invalid");

				if (jwtPayload) {
					log.auth("👤 JWT payload:", { userId: jwtPayload.userId, sessionId: jwtPayload.sessionId });

					// JWT authentication successful
					const fullUser = await getUserById(jwtPayload.userId);

					log.auth("📋 User lookup result:", fullUser ? "found" : "not found");

					if (fullUser) {
						c.set("user", fullUser as any);

						// Load the full session with access token
						const { session } = await lucia.validateSession(jwtPayload.sessionId);
						log.auth("🔍 Session lookup result:", session ? "found" : "not found");

						c.set("session", session);
						log.auth("✅ JWT auth successful for user:", fullUser.id);
						return next();
					}
				}
			} else {
				log.auth("🗝️  API key detected");
				// Regular API key
				const { user_id, error } = await getUserByAPIKey(token);

				log.auth("🔍 API key verification result:", error ? error : user_id ? "valid" : "invalid");

				if (!error && user_id) {
					// API key authentication successful
					const fullUser = await getUserById(user_id);

					log.auth("📋 User lookup result:", fullUser ? "found" : "not found");

					if (fullUser) {
						c.set("user", fullUser as any);
					} else {
						c.set("user", null);
					}
					c.set("session", null);
					log.auth("✅ API key auth successful for user:", user_id);
					return next();
				}
			}
		}
	}

	// Fall back to session-based authentication
	log.auth("🍪 Checking for session cookies");
	const sessionId = getCookie(c, lucia.sessionCookieName) ?? null;

	log.auth("🔍 Session cookie:", sessionId ? `${sessionId.substring(0, 10)}...` : "none");

	if (!sessionId) {
		log.auth("🚫 No session cookie found - setting null auth");
		c.set("user", null);
		c.set("session", null);
		return next();
	}

	log.auth("🔐 Validating session with Lucia");
	const { session, user } = await lucia.validateSession(sessionId);

	log.auth("📊 Session validation result:", {
		hasSession: !!session,
		hasUser: !!user,
		userId: user?.id,
		sessionId: session?.id,
		fresh: session?.fresh,
	});

	// Handle session refresh
	if (session?.fresh) {
		log.auth("🔄 Refreshing session cookie");
		const sessionCookie = lucia.createSessionCookie(session.id);
		c.header(
			"Set-Cookie",
			`${sessionCookie.name}=${sessionCookie.value}; ${Object.entries(sessionCookie.attributes)
				.map(([k, v]) => `${k}=${v}`)
				.join("; ")}`
		);
	}

	if (!session) {
		log.auth("🗑️  Clearing invalid session cookie");
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

	log.auth("🏁 Final auth state:", {
		hasUser: !!user,
		hasSession: !!session,
		authMethod: "session",
	});

	return next();
});

export const requireAuth = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
	const user = c.get("user");
	if (!user) {
		return c.json({ error: "Unauthorized" }, 401);
	}
	return next();
});
