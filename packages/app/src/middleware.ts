import type { MiddlewareHandler } from "astro";
import { defineMiddleware } from "astro:middleware";
import { verifyRequestOrigin } from "lucia";

// Browser-safe logger for middleware
const log = {
	middleware: typeof console !== "undefined" ? console.log.bind(console, "[MIDDLEWARE]") : () => {},
	error: typeof console !== "undefined" ? console.error.bind(console, "[MIDDLEWARE]") : () => {},
};

const history_ignore = ["/api", "/favicon", "/images", "/public"];
const origin_ignore = ["/api"];

const API_SERVER_URL = process.env.PUBLIC_API_SERVER_URL || "http://localhost:3001/api/v0";
const API_SERVER_BASE = API_SERVER_URL.replace("/api/v0", "") || "http://localhost:3001";

export const onRequest: MiddlewareHandler = defineMiddleware(async (context, next) => {
	log.middleware(` Processing ${context.request.method} ${context.url.pathname}`);

	if (context.request.method !== "GET") {
		const originHeader = context.request.headers.get("Origin");
		const hostHeader = context.request.headers.get("Host");
		// check for missing or invalid headers
		const checks = [!originHeader, !hostHeader, !verifyRequestOrigin(originHeader!, [hostHeader!])];
		const ignore = origin_ignore.find(p => context.url.pathname.startsWith(p));
		log.middleware(` CSRF check:`, { originHeader, hostHeader, ignore });
		if (checks.some(c => c) && !ignore) {
			log.error(" Invalid origin", { originHeader, hostHeader });
			return new Response("Invalid origin", {
				status: 403,
			});
		}
	}

	// Handle session history for GET requests
	if (context.request.method === "GET" && !history_ignore.find(p => context.url.pathname.includes(p))) {
		log.middleware(` Processing history for ${context.url.pathname}`);
		// Get existing history from cookie
		const historyCookie = context.cookies.get("nav-history")?.value;
		let history: string[] = [];

		try {
			history = historyCookie ? JSON.parse(decodeURIComponent(historyCookie)) : [];
			log.middleware(` Current history:`, history);
		} catch {
			history = [];
			log.middleware(` Failed to parse history, starting fresh`);
		}

		if (context.url.searchParams.get("back") === "true") {
			// Remove the last page for back navigation
			history.pop();
			log.middleware(` Back navigation, history now:`, history);
		} else if (context.url.pathname !== history.at(-1)) {
			// Don't add the same page twice
			history.push(context.url.pathname);
			log.middleware(` Added to history:`, history);
		}

		// Clean up history
		if (history.at(-1) === "/") {
			history = [];
		} else if (history.length > 15) {
			history.shift();
		}

		// Store updated history in cookie
		if (history.length > 0) {
			context.cookies.set("nav-history", encodeURIComponent(JSON.stringify(history)), {
				path: "/",
				maxAge: 60 * 60 * 24, // 24 hours
				sameSite: "lax",
			});
		}

		// Make history available to pages
		context.locals.history = history;
	}

	log.middleware("🔐 Starting auth check for:", context.url.pathname);

	// Initialize user as null
	context.locals.user = null;
	context.locals.session = null;

	// Check for JWT token in localStorage (handled client-side) or session cookie
	const jwtToken = context.url.searchParams.get("token"); // From OAuth callback

	// Check for various possible session cookie names (Lucia default is usually "auth_session")
	const sessionCookie1 = context.cookies.get("auth-session")?.value;
	const sessionCookie2 = context.cookies.get("auth_session")?.value;
	const sessionCookie3 = context.cookies.get("lucia_session")?.value;
	const sessionCookie = sessionCookie1 || sessionCookie2 || sessionCookie3;

	const storedJWT = context.cookies.get("jwt-token")?.value;

	log.middleware(" 🍪 Auth cookies found:", {
		hasJwtToken: !!jwtToken,
		hasSessionCookie: !!sessionCookie,
		hasStoredJWT: !!storedJWT,
		sessionCookieSource: sessionCookie1 ? "auth-session" : sessionCookie2 ? "auth_session" : sessionCookie3 ? "lucia_session" : "none",
		"auth-session": !!sessionCookie1,
		auth_session: !!sessionCookie2,
		lucia_session: !!sessionCookie3,
	});

	if (jwtToken) {
		log.middleware(" 🔄 JWT token in URL - storing in cookie and redirecting");
		// Store JWT token with secure settings (accessible to both server and client)
		const secure = context.site?.protocol === "https:" ? "; Secure" : "";
		const response = new Response(null, {
			status: 302,
			headers: {
				Location: context.url.pathname,
				"Set-Cookie": `jwt-token=${jwtToken}; Path=/; SameSite=Lax${secure}; Max-Age=86400`,
			},
		});
		return response;
	}

	if (storedJWT || sessionCookie) {
		log.middleware(" 📞 Making API call to verify auth");

		try {
			// Call API to verify authentication
			const authHeader = storedJWT ? `Bearer jwt:${storedJWT}` : undefined;
			// Use the detected cookie name for the header
			const cookieHeader = sessionCookie ? (sessionCookie1 ? `auth-session=${sessionCookie}` : sessionCookie2 ? `auth_session=${sessionCookie}` : sessionCookie3 ? `lucia_session=${sessionCookie}` : undefined) : undefined;

			log.middleware(" 📡 Auth request headers:", {
				hasAuthHeader: !!authHeader,
				hasCookieHeader: !!cookieHeader,
				apiUrl: `${API_SERVER_BASE}/api/auth/verify`,
			});

			const response = await fetch(`${API_SERVER_BASE}/api/auth/verify`, {
				headers: {
					...(authHeader && { Authorization: authHeader }),
					...(cookieHeader && { Cookie: cookieHeader }),
					"Content-Type": "application/json",
				},
			});

			log.middleware(" 📋 API response:", {
				status: response.status,
				ok: response.ok,
			});

			if (response.ok) {
				const authData = await response.json();
				log.middleware(" ✅ Auth successful:", {
					authenticated: authData.authenticated,
					hasUser: !!authData.user,
					userId: authData.user?.id,
				});

				context.locals.user = authData.user;
				context.locals.session = { id: "verified" } as any; // Minimal session object
				context.locals.jwtToken = storedJWT; // Pass JWT token for server-side API calls

				// Update existing HttpOnly cookie to be accessible to client-side JS
				// This is needed for users who logged in before we changed the cookie settings
				if (storedJWT) {
					context.cookies.set("jwt-token", storedJWT, {
						path: "/",
						sameSite: "lax",
						secure: context.site?.protocol === "https:",
						maxAge: 86400,
						httpOnly: false, // Make it accessible to JavaScript
					});
				}
			} else {
				const errorData = await response.text();
				log.middleware(" ❌ Auth failed:", errorData);
			}
		} catch (error) {
			// API unreachable or error - continue without auth
			log.error(" 🚨 Auth verification failed:", error);
		}
	} else {
		log.middleware(" 🚫 No auth tokens found");
	}

	log.middleware(" 🏁 Final auth state:", {
		hasUser: !!context.locals.user,
		hasSession: !!context.locals.session,
		userId: context.locals.user?.id,
	});

	return next();
});
