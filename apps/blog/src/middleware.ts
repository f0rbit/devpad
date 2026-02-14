import { defineMiddleware } from "astro:middleware";
import type { MiddlewareHandler } from "astro";

const API_SERVER_BASE = process.env.PUBLIC_API_SERVER_URL?.replace("/api/v1", "") ?? "";

export const onRequest: MiddlewareHandler = defineMiddleware(async (context, next) => {
	context.locals.user = null;
	context.locals.session = null;

	const auth_user_header = context.request.headers.get("X-Auth-User");
	if (auth_user_header) {
		try {
			context.locals.user = JSON.parse(auth_user_header);
			context.locals.session = { id: context.request.headers.get("X-Auth-Session-Id") ?? "injected" };
		} catch {
			// invalid header
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
			headers: { Location: clean_url.pathname + clean_url.search || "/" },
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
