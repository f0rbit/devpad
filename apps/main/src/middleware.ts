import { defineMiddleware } from "astro:middleware";
import type { AuthUser } from "@devpad/schema/bindings";
import type { MiddlewareHandler } from "astro";

function verifyRequestOrigin(origin: string, allowed_hosts: string[]): boolean {
	if (!origin) return false;
	const origin_host = new URL(origin).host;
	return allowed_hosts.some(host => host === origin_host);
}

const history_ignore = ["/api", "/favicon", "/images", "/public", "/_astro"];
const origin_ignore = ["/api"];

const API_SERVER_BASE = process.env.PUBLIC_API_SERVER_URL?.replace("/api/v1", "") ?? "";

export const onRequest: MiddlewareHandler = defineMiddleware(async (context, next) => {
	if (context.request.method !== "GET") {
		const originHeader = context.request.headers.get("Origin");
		const rawHostHeader = context.request.headers.get("Host");
		const hostHeader = rawHostHeader?.split(",")[0]?.trim();

		const checks = [!originHeader, !hostHeader, !verifyRequestOrigin(originHeader!, [hostHeader!])];
		const ignore = origin_ignore.find(p => context.url.pathname.startsWith(p));
		if (checks.some(c => c) && !ignore) {
			return new Response("Invalid origin", { status: 403 });
		}
	}

	if (context.request.method === "GET" && !history_ignore.find(p => context.url.pathname.includes(p))) {
		const historyCookie = context.cookies.get("nav-history")?.value;
		let history: string[] = [];

		try {
			history = historyCookie ? JSON.parse(decodeURIComponent(historyCookie)) : [];
		} catch {
			history = [];
		}

		if (context.url.searchParams.get("back") === "true") {
			history.pop();
		} else if (context.url.pathname !== history.at(-1)) {
			history.push(context.url.pathname);
		}

		if (history.at(-1) === "/") {
			history = [];
		} else if (history.length > 15) {
			history.shift();
		}

		if (history.length > 0) {
			context.cookies.set("nav-history", encodeURIComponent(JSON.stringify(history)), {
				path: "/",
				maxAge: 60 * 60 * 24,
				sameSite: "lax",
			});
		}

		context.locals.history = history;
	}

	context.locals.user = null;
	context.locals.session = null;

	const is_test_env = process.env.NODE_ENV === "test" || process.env.TEST_MODE === "enabled";
	const has_test_header = context.request.headers.get("X-Test-User") === "true";

	if (is_test_env && has_test_header) {
		context.locals.user = {
			id: "test-user-e2e",
			github_id: null,
			name: "Test User",
			task_view: "list" as const,
		} as unknown as NonNullable<AuthUser>;
		context.locals.session = { id: "test-session" };
		return next();
	}

	const auth_user_header = context.request.headers.get("X-Auth-User");
	if (auth_user_header) {
		try {
			context.locals.user = JSON.parse(auth_user_header);
			context.locals.session = { id: context.request.headers.get("X-Auth-Session-Id") ?? "injected" };
		} catch {
			// invalid header, continue unauthenticated
		}
		return next();
	}

	const session_param = context.url.searchParams.get("auth_session");
	if (session_param) {
		context.cookies.set("auth_session", session_param, {
			path: "/",
			sameSite: "lax",
			maxAge: 60 * 60 * 24 * 30,
			httpOnly: false,
		});
		const clean_url = new URL(context.url);
		clean_url.searchParams.delete("auth_session");
		return new Response(null, {
			status: 302,
			headers: { Location: clean_url.pathname + clean_url.search },
		});
	}

	const session_cookie = context.cookies.get("auth_session")?.value;
	if (!API_SERVER_BASE || !session_cookie) return next();

	if (session_cookie) {
		try {
			const response = await fetch(`${API_SERVER_BASE}/api/auth/session`, {
				headers: {
					Cookie: `auth_session=${session_cookie}`,
					"Content-Type": "application/json",
				},
			});

			if (response.ok) {
				const data = (await response.json()) as { authenticated: boolean; user: any };
				if (data.authenticated && data.user) {
					context.locals.user = data.user;
					context.locals.session = { id: "verified" };
				}
			}
		} catch {
			// dev server unreachable
		}
	}

	return next();
});
