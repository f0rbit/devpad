import type { AuthUser } from "@devpad/schema/bindings";

interface CookieAdapter {
	get(name: string): string | undefined;
	set(name: string, value: string, options: Record<string, unknown>): void;
}

interface AuthResult {
	user: AuthUser;
	session: { id: string } | null;
	redirect?: string;
}

export async function resolveAuth(request: Request, cookies: CookieAdapter, apiServerBase: string): Promise<AuthResult> {
	let user: AuthUser = null;
	let session: { id: string } | null = null;

	const authUserHeader = request.headers.get("X-Auth-User");
	if (authUserHeader) {
		try {
			user = JSON.parse(authUserHeader);
			session = { id: request.headers.get("X-Auth-Session-Id") ?? "injected" };
		} catch {}
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
			const data = (await response.json()) as { authenticated: boolean; user: any };
			if (data.authenticated && data.user) {
				user = data.user;
				session = { id: "verified" };
			}
		}
	} catch {}

	return { user, session };
}
