import { defineMiddleware } from "astro:middleware";
import { resolveAuth } from "@devpad/core/ui/middleware";
import type { MiddlewareHandler } from "astro";

const API_SERVER_BASE = process.env.PUBLIC_API_SERVER_URL?.replace("/api/v1", "") ?? "";

export const onRequest: MiddlewareHandler = defineMiddleware(async (context, next) => {
	const cookies = {
		get: (name: string) => context.cookies.get(name)?.value,
		set: (name: string, value: string, opts: any) => context.cookies.set(name, value, opts),
	};
	const result = await resolveAuth(context.request, cookies, API_SERVER_BASE);
	context.locals.user = result.user;
	context.locals.session = result.session;
	if (result.redirect) {
		return new Response(null, { status: 302, headers: { Location: result.redirect } });
	}
	return next();
});
