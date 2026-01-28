import { defineMiddleware } from "astro:middleware";
import { log } from "@devpad/core/logger";
import type { AuthUser } from "@devpad/schema/bindings";
import type { MiddlewareHandler } from "astro";

type AuthVerifyResponse = {
	authenticated: boolean;
	user: NonNullable<AuthUser>;
};

function verifyRequestOrigin(origin: string, allowed_hosts: string[]): boolean {
	if (!origin) return false;
	const origin_host = new URL(origin).host;
	return allowed_hosts.some(host => host === origin_host);
}

const history_ignore = ["/api", "/favicon", "/images", "/public", "/_astro"];
const origin_ignore = ["/api"];

if (!process.env.PUBLIC_API_SERVER_URL) {
	throw new Error("PUBLIC_API_SERVER_URL environment variable is not set");
}

const API_SERVER_URL = process.env.PUBLIC_API_SERVER_URL;
const API_SERVER_BASE = API_SERVER_URL.replace("/api/v1", "");

export const onRequest: MiddlewareHandler = defineMiddleware(async (context, next) => {
	log.middleware(` Processing ${context.request.method} ${context.url.pathname}`);

	if (context.request.method !== "GET") {
		const originHeader = context.request.headers.get("Origin");
		const rawHostHeader = context.request.headers.get("Host");

		// Handle duplicate Host headers (e.g., from load balancers/proxies)
		// Take the first value and remove duplicates
		const hostHeader = rawHostHeader?.split(",")[0]?.trim();

		// check for missing or invalid headers
		const checks = [!originHeader, !hostHeader, !verifyRequestOrigin(originHeader!, [hostHeader!])];
		const ignore = origin_ignore.find(p => context.url.pathname.startsWith(p));
		log.middleware(` CSRF check:`, { originHeader, hostHeader: rawHostHeader, parsedHost: hostHeader, ignore });
		if (checks.some(c => c) && !ignore) {
			log.error(" Invalid origin", { originHeader, hostHeader: rawHostHeader, parsedHost: hostHeader });
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

	// Check for test user injection (only works when NODE_ENV=test or TEST_MODE=enabled)
	// Note: We check process.env directly here since this runs on the server
	const isTestEnv = process.env.NODE_ENV === "test" || process.env.TEST_MODE === "enabled";
	const hasTestHeader = context.request.headers.get("X-Test-User") === "true";

	if (isTestEnv && hasTestHeader) {
		log.middleware("🧪 TEST MODE: Injecting mock user");
		// Import test user constants dynamically to avoid bundling in production
		// @ts-expect-error
		const { TEST_USER, TEST_SESSION, TEST_JWT_TOKEN } = await import("../../../tests/shared/test-user");

		context.locals.user = TEST_USER as unknown as NonNullable<AuthUser>;
		context.locals.session = TEST_SESSION as App.Locals["session"];
		context.locals.jwtToken = TEST_JWT_TOKEN;

		// Set cookie for client-side API access
		context.cookies.set("jwt-token", TEST_JWT_TOKEN, {
			path: "/",
			sameSite: "lax",
			maxAge: 86400,
			httpOnly: false, // Allow client-side access
		});

		// Skip rest of auth flow for test user
		return next();
	}

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

			// Pass through X-Test-User header if present (for test environments)
			const testUserHeader = context.request.headers.get("X-Test-User");

			log.middleware(" 📡 Auth request headers:", {
				hasAuthHeader: !!authHeader,
				hasCookieHeader: !!cookieHeader,
				hasTestHeader: !!testUserHeader,
				apiUrl: `${API_SERVER_BASE}/api/auth/verify`,
			});

			const response = await fetch(`${API_SERVER_BASE}/api/auth/verify`, {
				headers: {
					...(authHeader && { Authorization: authHeader }),
					...(cookieHeader && { Cookie: cookieHeader }),
					...(testUserHeader && { "X-Test-User": testUserHeader }),
					"Content-Type": "application/json",
				},
			});

			log.middleware(" 📋 API response:", {
				status: response.status,
				ok: response.ok,
			});

			if (response.ok) {
				const authData = (await response.json()) as AuthVerifyResponse;
				log.middleware(" ✅ Auth successful:", {
					authenticated: authData.authenticated,
					hasUser: !!authData.user,
					userId: authData.user?.id,
				});

				context.locals.user = authData.user;
				context.locals.session = { id: "verified" };
				context.locals.jwtToken = storedJWT ?? null; // Pass JWT token for server-side API calls

				// If this is a test user, ensure the JWT cookie is set for client-side
				if (authData.user?.id === "test-user-e2e") {
					log.middleware(" 🧪 Test user detected, setting test JWT cookie");
					context.cookies.set("jwt-token", "test-jwt-token", {
						path: "/",
						sameSite: "lax",
						maxAge: 86400,
						httpOnly: false, // Allow client-side access
					});
					context.locals.jwtToken = "test-jwt-token";
				}

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
