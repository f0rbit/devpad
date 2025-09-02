import { createGitHubAuthUrl, getUserById, handleGitHubCallback, invalidateUserSession, lucia } from "@devpad/core";
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { AuthContext } from "../middleware/auth";

const app = new Hono<AuthContext>();

/**
 * GET /api/auth/login
 * Initiate GitHub OAuth flow by generating auth URL and setting state cookie
 */
app.get("/login", async c => {
	try {
		const { url, state } = await createGitHubAuthUrl();

		// Set secure state cookie for CSRF protection
		setCookie(c, "github_oauth_state", state, {
			path: "/",
			secure: process.env.NODE_ENV === "production",
			httpOnly: true,
			maxAge: 60 * 10, // 10 minutes
			sameSite: "Lax",
		});

		// Redirect to GitHub OAuth
		return c.redirect(url);
	} catch (error) {
		console.error("Login error:", error);
		return c.json({ error: "Failed to initiate GitHub OAuth" }, 500);
	}
});

/**
 * GET /api/auth/callback
 * Handle GitHub OAuth callback and create user session
 */
app.get("/callback", async c => {
	try {
		const code = c.req.query("code");
		const state = c.req.query("state");
		const storedState = getCookie(c, "github_oauth_state");

		if (!code || !state || !storedState || state !== storedState) {
			return c.json({ error: "Invalid OAuth parameters" }, 400);
		}

		// Handle OAuth callback and create session
		const result = await handleGitHubCallback(code, state, storedState);

		// Set session cookie
		const sessionCookie = lucia.createSessionCookie(result.sessionId);
		setCookie(c, sessionCookie.name, sessionCookie.value, sessionCookie.attributes);

		// Clear OAuth state cookie
		setCookie(c, "github_oauth_state", "", {
			path: "/",
			maxAge: 0,
		});

		// Redirect to projects page
		return c.redirect("/project");
	} catch (error) {
		console.error("Callback error:", error);
		return c.json({ error: "OAuth callback failed" }, 500);
	}
});

/**
 * GET /api/auth/logout
 * Logout user by invalidating session and clearing cookies
 */
app.get("/logout", async c => {
	try {
		const session = c.get("session");

		if (!session) {
			return c.json({ error: "Not authenticated" }, 401);
		}

		// Invalidate the session
		await invalidateUserSession(session.id);

		// Clear session cookie
		const sessionCookie = lucia.createBlankSessionCookie();
		setCookie(c, sessionCookie.name, sessionCookie.value, sessionCookie.attributes);

		// Redirect to home page
		return c.redirect("/");
	} catch (error) {
		console.error("Logout error:", error);
		return c.json({ error: "Logout failed" }, 500);
	}
});

/**
 * GET /api/auth/session
 * Return current session information
 */
app.get("/session", async c => {
	try {
		const user = c.get("user");
		const session = c.get("session");

		if (!user || !session) {
			return c.json({
				authenticated: false,
				user: null,
				session: null,
			});
		}

		// Get full user data including email and image_url
		const fullUser = await getUserById(user.id);

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
		console.error("Session error:", error);
		return c.json({ error: "Failed to get session" }, 500);
	}
});

export default app;
