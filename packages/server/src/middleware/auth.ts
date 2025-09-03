import { getUserById } from "@devpad/core";
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
	console.log(`🔍 [SERVER-AUTH] Processing ${c.req.method} ${c.req.path}`);

	// CSRF protection for non-GET requests (skip in test environment)
	const isTest = process.env.NODE_ENV === "test";
	if (c.req.method !== "GET" && !isTest) {
		const originHeader = c.req.header("Origin");
		const hostHeader = c.req.header("Host");

		console.log(`🔍 [SERVER-AUTH] CSRF check:`, { originHeader, hostHeader, isTest });
		if (!originHeader || !hostHeader || !verifyRequestOrigin(originHeader, [hostHeader])) {
			console.error("❌ [SERVER-AUTH] Invalid origin", { originHeader, hostHeader, isTest, nodeEnv: process.env.NODE_ENV });
			return c.json({ error: "Invalid origin" }, 403);
		}
	}

	// Check for API key authentication first
	const authHeader = c.req.header("Authorization");
	console.log("[AUTH_MIDDLEWARE] 🔑 Auth header:", authHeader ? `Bearer ${authHeader.split(" ")[1]?.substring(0, 10)}...` : "none");

	if (authHeader?.startsWith("Bearer ")) {
		const token = authHeader.split(" ")[1];
		if (token) {
			// Check if token has JWT prefix
			if (token.startsWith("jwt:")) {
				console.log("[AUTH_MIDDLEWARE] 🎟️  JWT token detected");
				// JWT token
				const jwtToken = token.substring(4);
				const jwtPayload = verifyJWT(jwtToken);

				console.log("[AUTH_MIDDLEWARE] 🔍 JWT verification result:", jwtPayload ? "valid" : "invalid");

				if (jwtPayload) {
					console.log("[AUTH_MIDDLEWARE] 👤 JWT payload:", { userId: jwtPayload.userId, sessionId: jwtPayload.sessionId });

					// JWT authentication successful
					const fullUser = await getUserById(jwtPayload.userId);

					console.log("[AUTH_MIDDLEWARE] 📋 User lookup result:", fullUser ? "found" : "not found");

					if (fullUser) {
						c.set("user", fullUser as any);
						// Create a minimal session object for JWT
						c.set("session", { id: jwtPayload.sessionId });
						console.log("[AUTH_MIDDLEWARE] ✅ JWT auth successful for user:", fullUser.id);
						return next();
					}
				}
			} else {
				console.log("[AUTH_MIDDLEWARE] 🗝️  API key detected");
				// Regular API key
				const { user_id, error } = await getUserByAPIKey(token);

				console.log("[AUTH_MIDDLEWARE] 🔍 API key verification result:", error ? error : user_id ? "valid" : "invalid");

				if (!error && user_id) {
					// API key authentication successful
					const fullUser = await getUserById(user_id);

					console.log("[AUTH_MIDDLEWARE] 📋 User lookup result:", fullUser ? "found" : "not found");

					if (fullUser) {
						c.set("user", fullUser as any);
					} else {
						c.set("user", null);
					}
					c.set("session", null);
					console.log("[AUTH_MIDDLEWARE] ✅ API key auth successful for user:", user_id);
					return next();
				}
			}
		}
	}

	// Fall back to session-based authentication
	console.log("[AUTH_MIDDLEWARE] 🍪 Checking for session cookies");
	const sessionId = getCookie(c, lucia.sessionCookieName) ?? null;

	console.log("[AUTH_MIDDLEWARE] 🔍 Session cookie:", sessionId ? `${sessionId.substring(0, 10)}...` : "none");

	if (!sessionId) {
		console.log("[AUTH_MIDDLEWARE] 🚫 No session cookie found - setting null auth");
		c.set("user", null);
		c.set("session", null);
		return next();
	}

	console.log("[AUTH_MIDDLEWARE] 🔐 Validating session with Lucia");
	const { session, user } = await lucia.validateSession(sessionId);

	console.log("[AUTH_MIDDLEWARE] 📊 Session validation result:", {
		hasSession: !!session,
		hasUser: !!user,
		userId: user?.id,
		sessionId: session?.id,
		fresh: session?.fresh,
	});

	// Handle session refresh
	if (session?.fresh) {
		console.log("[AUTH_MIDDLEWARE] 🔄 Refreshing session cookie");
		const sessionCookie = lucia.createSessionCookie(session.id);
		c.header(
			"Set-Cookie",
			`${sessionCookie.name}=${sessionCookie.value}; ${Object.entries(sessionCookie.attributes)
				.map(([k, v]) => `${k}=${v}`)
				.join("; ")}`
		);
	}

	if (!session) {
		console.log("[AUTH_MIDDLEWARE] 🗑️  Clearing invalid session cookie");
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

	console.log("[AUTH_MIDDLEWARE] 🏁 Final auth state:", {
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
