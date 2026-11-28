import { AuthUserSchema, type AuthUser } from "@devpad/schema/bindings";
import { z } from "zod";

import { createLogger } from "../utils/logger";

const auth_log = createLogger("ui.auth");

const SessionCheckResponseSchema = z.object({
	authenticated: z.boolean(),
	user: AuthUserSchema,
});

type CookieAdapter = {
	get(name: string): string | undefined;
	set(name: string, value: string, options: Record<string, unknown>): void;
};

type AuthResult = {
	user: AuthUser;
	session: { id: string } | null;
	redirect?: string;
};

export async function resolveAuth(
	request: Request,
	cookies: CookieAdapter,
	apiServerBase: string,
): Promise<AuthResult> {
	let user: AuthUser = null;
	let session: { id: string } | null = null;

	const authUserHeader = request.headers.get("X-Auth-User");
	if (authUserHeader) {
		try {
			user = AuthUserSchema.parse(JSON.parse(authUserHeader));
			session = { id: request.headers.get("X-Auth-Session-Id") ?? "injected" };
		} catch (error) {
			auth_log.warn("X-Auth-User header failed validation, degrading to anonymous", {
				error: error instanceof Error ? error.message : String(error),
			});
		}
		return { user, session };
	}

	const url = new URL(request.url);
	const sessionParam = url.searchParams.get("auth_session");
	if (sessionParam) {
		cookies.set("auth_session", sessionParam, {
			path: "/",
			sameSite: "lax",
			maxAge: 60 * 60 * 24 * 30,
			httpOnly: false,
		});
		const cleanUrl = new URL(url);
		cleanUrl.searchParams.delete("auth_session");
		return { user, session, redirect: cleanUrl.pathname + (cleanUrl.search || "/") };
	}

	const sessionCookie = cookies.get("auth_session");
	if (!apiServerBase || !sessionCookie) return { user, session };

	try {
		const response = await fetch(`${apiServerBase}/api/auth/session`, {
			headers: {
				Cookie: `auth_session=${sessionCookie}`,
				"Content-Type": "application/json",
			},
		});
		if (response.ok) {
			const data = SessionCheckResponseSchema.parse(await response.json());
			if (data.authenticated && data.user) {
				user = data.user;
				session = { id: "verified" };
			}
		}
	} catch (error) {
		auth_log.warn("session check failed, degrading to anonymous", {
			error: error instanceof Error ? error.message : String(error),
		});
	}

	return { user, session };
}
