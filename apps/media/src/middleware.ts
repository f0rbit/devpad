import { defineMiddleware } from "astro:middleware";
import type { MiddlewareHandler } from "astro";

if (!process.env.PUBLIC_API_SERVER_URL) {
	throw new Error("PUBLIC_API_SERVER_URL environment variable is not set");
}

const API_SERVER_URL = process.env.PUBLIC_API_SERVER_URL;
const API_SERVER_BASE = API_SERVER_URL.replace("/api/v1", "");

export const onRequest: MiddlewareHandler = defineMiddleware(async (context, next) => {
	context.locals.user = null;
	context.locals.session = null;
	context.locals.jwtToken = null;

	const storedJWT = context.cookies.get("jwt-token")?.value;

	if (!storedJWT) return next();

	try {
		const response = await fetch(`${API_SERVER_BASE}/api/auth/verify`, {
			headers: {
				Authorization: `Bearer jwt:${storedJWT}`,
				"Content-Type": "application/json",
			},
		});

		if (response.ok) {
			const data = (await response.json()) as { authenticated: boolean; user: any };
			if (data.authenticated && data.user) {
				context.locals.user = data.user;
				context.locals.session = { id: "verified" };
				context.locals.jwtToken = storedJWT;
			}
		}
	} catch {
		// auth verification failed, continue without auth
	}

	return next();
});
