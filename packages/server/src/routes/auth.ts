import { createGitHubAuthUrl, getUserById, handleGitHubCallback, invalidateUserSession, lucia, generateJWT, log } from "@devpad/core";
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { AuthContext } from "../middleware/auth";

const app = new Hono<AuthContext>();

/**
 * GET /api/auth/login
 * Initiate GitHub OAuth flow by generating auth URL and setting state cookie
 */
app.get("/login", async c => {
	log.auth("[LOGIN] Login endpoint called");
	try {
		const { url, state } = await createGitHubAuthUrl();

		log.auth("[🔗 [AUTH-LOGIN] Generated OAuth URL:", { state: state.substring(0, 10) + "..." });

		// Set secure state cookie for CSRF protection
		setCookie(c, "github_oauth_state", state, {
			path: "/",
			secure: process.env.NODE_ENV === "production",
			httpOnly: true,
			maxAge: 60 * 10, // 10 minutes
			sameSite: "Lax",
		});

		log.auth("[LOGIN] Redirecting to GitHub OAuth");
		// Redirect to GitHub OAuth
		return c.redirect(url);
	} catch (error) {
		log.error("[LOGIN] Login error:", error);
		return c.json({ error: "Failed to initiate GitHub OAuth" }, 500);
	}
});

/**
 * GET /api/auth/callback/github
 * Handle GitHub OAuth callback and create user session
 */
app.get("/callback/github", async c => {
	log.auth("[CALLBACK] GitHub OAuth callback received");
	try {
		const code = c.req.query("code");
		const state = c.req.query("state");
		const storedState = getCookie(c, "github_oauth_state");

		log.auth("[CALLBACK] OAuth parameters:", {
			hasCode: !!code,
			hasState: !!state,
			hasStoredState: !!storedState,
			statesMatch: state === storedState,
		});

		if (!code || !state || !storedState || state !== storedState) {
			log.error("[CALLBACK] Invalid OAuth parameters");
			return c.json({ error: "Invalid OAuth parameters" }, 400);
		}

		log.auth("[CALLBACK] Processing GitHub callback");
		// Handle OAuth callback and create session
		const result = await handleGitHubCallback(code, state, storedState);

		log.auth("[CALLBACK] OAuth successful:", { userId: result.user.id, sessionId: result.sessionId });

		// Generate JWT token for cross-domain auth
		const token = generateJWT({
			userId: result.user.id,
			sessionId: result.sessionId,
		});

		log.auth("[CALLBACK] Generated JWT token");

		// Set session cookie for same-domain access
		const sessionCookie = lucia.createSessionCookie(result.sessionId);
		setCookie(c, sessionCookie.name, sessionCookie.value, sessionCookie.attributes);

		log.auth("[CALLBACK] Set session cookie:", sessionCookie.name);

		// Clear OAuth state cookie
		setCookie(c, "github_oauth_state", "", {
			path: "/",
			maxAge: 0,
		});

		// Check if we should redirect with JWT token (cross-domain) or use cookie (same-domain)
		const frontendUrl = Bun.env.FRONTEND_URL || "http://localhost:3000"; // Default to frontend
		const originHeader = c.req.header("Origin");

		log.auth("[🌐 [AUTH-CALLBACK] Redirect decision:", {
			frontendUrl,
			originHeader,
			isCrossDomain: frontendUrl && frontendUrl !== originHeader,
		});

		if (frontendUrl && frontendUrl !== originHeader) {
			// Cross-domain: redirect with JWT token
			log.auth("[🔀 [AUTH-CALLBACK] Cross-domain redirect with JWT");
			return c.redirect(`${frontendUrl}/auth/callback?token=${token}`);
		} else {
			// Same-domain development: redirect to frontend server
			log.auth("[🔀 [AUTH-CALLBACK] Redirecting to frontend server");
			return c.redirect(`${frontendUrl}/project`);
		}
	} catch (error) {
		log.error("[CALLBACK] Callback error:", error);
		return c.json({ error: "OAuth callback failed" }, 500);
	}
});

/**
 * GET /api/auth/logout
 * Logout user by invalidating session and clearing cookies
 */
app.get("/logout", async c => {
	log.auth("[LOGOUT] Logout endpoint called");
	try {
		const session = c.get("session");

		if (session) {
			log.auth("[🗑️  [AUTH-LOGOUT] Invalidating session:", session.id);
			// Invalidate the session if it exists
			await invalidateUserSession(session.id);

			// Clear session cookie
			const sessionCookie = lucia.createBlankSessionCookie();
			setCookie(c, sessionCookie.name, sessionCookie.value, sessionCookie.attributes);
		} else {
			log.auth("[ℹ️  [AUTH-LOGOUT] No session to invalidate");
		}

		// Check if we should redirect to frontend URL
		const frontendUrl = Bun.env.FRONTEND_URL || "http://localhost:3000";
		const originHeader = c.req.header("Origin");

		log.auth("[🌐 [AUTH-LOGOUT] Redirect decision:", {
			frontendUrl,
			originHeader,
			isCrossDomain: frontendUrl && frontendUrl !== originHeader,
		});

		if (frontendUrl && frontendUrl !== originHeader) {
			// Cross-domain: redirect to frontend with logout flag
			log.auth("[🔀 [AUTH-LOGOUT] Cross-domain logout redirect");
			return c.redirect(`${frontendUrl}/auth/logout`);
		} else {
			// Same-domain development: redirect to frontend server
			log.auth("[🔀 [AUTH-LOGOUT] Redirecting to frontend server");
			return c.redirect(`${frontendUrl}/`);
		}
	} catch (error) {
		log.error("[LOGOUT] Logout error:", error);
		return c.json({ error: "Logout failed" }, 500);
	}
});

/**
 * GET /api/auth/session
 * Return current session information
 */
app.get("/session", async c => {
	log.auth("[SESSION] Session endpoint called");
	try {
		const user = c.get("user");
		const session = c.get("session");

		log.auth("[SESSION] Current auth state:", {
			hasUser: !!user,
			hasSession: !!session,
			userId: user?.id,
		});

		if (!user || !session) {
			log.auth("[❌ [AUTH-SESSION] No user/session found");
			return c.json({
				authenticated: false,
				user: null,
				session: null,
			});
		}

		// Get full user data including email and image_url
		const fullUser = await getUserById(user.id);

		log.auth("[SESSION] Returning session data for user:", user.id);
		return c.json({
			authenticated: true,
			user: fullUser
				? {
						id: fullUser.id,
						name: fullUser.name,
						email: fullUser.email,
						github_id: fullUser.github_id,
						image_url: fullUser.image_url,
						task_view: fullUser.task_view,
					}
				: {
						id: user.id,
						name: user.name,
						github_id: user.github_id,
						task_view: user.task_view,
					},
			session: {
				id: session.id,
			},
		});
	} catch (error) {
		log.error("[SESSION] Session error:", error);
		return c.json({ error: "Failed to get session" }, 500);
	}
});

/**
 * GET /api/auth/verify
 * Verify JWT token and return user information
 * This endpoint is used by the frontend to verify authentication
 */
app.get("/verify", async c => {
	log.auth("[VERIFY] Verify endpoint called");
	try {
		const user = c.get("user");
		const session = c.get("session");

		log.auth("[VERIFY] Current auth state:", {
			hasUser: !!user,
			hasSession: !!session,
			userId: user?.id,
		});

		// API_KEY auth bypasses JWT - if we have user from API key, return immediately
		if (user && !session) {
			log.auth("[🗝️  [AUTH-VERIFY] API key authentication detected");
			const fullUser = await getUserById(user.id);
			log.auth("[VERIFY] Returning API key user:", { userId: user.id });
			return c.json({
				authenticated: true,
				user: fullUser
					? {
							id: fullUser.id,
							name: fullUser.name,
							email: fullUser.email,
							github_id: fullUser.github_id,
							image_url: fullUser.image_url,
							task_view: fullUser.task_view,
						}
					: {
							id: user.id,
							name: user.name,
							github_id: user.github_id,
							task_view: user.task_view,
						},
			});
		}

		// Session-based auth (JWT or session cookie)
		if (!user || !session) {
			log.auth("[❌ [AUTH-VERIFY] No user/session found, returning unauthenticated");
			return c.json({ authenticated: false }, 401);
		}

		log.auth("[VERIFY] Session/JWT authentication detected");
		const fullUser = await getUserById(user.id);
		log.auth("[VERIFY] Returning authenticated user:", { userId: user.id });
		return c.json({
			authenticated: true,
			user: fullUser
				? {
						id: fullUser.id,
						name: fullUser.name,
						email: fullUser.email,
						github_id: fullUser.github_id,
						image_url: fullUser.image_url,
						task_view: fullUser.task_view,
					}
				: {
						id: user.id,
						name: user.name,
						github_id: user.github_id,
						task_view: user.task_view,
					},
		});
	} catch (error) {
		log.error("[VERIFY] Verify error:", error);
		return c.json({ error: "Verification failed" }, 500);
	}
});

export default app;
