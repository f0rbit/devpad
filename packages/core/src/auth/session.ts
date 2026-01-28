import { session, user } from "@devpad/schema/database/schema";
import { err, ok, type Result } from "@f0rbit/corpus";
import { eq } from "drizzle-orm";

export type SessionUser = {
	id: string;
	github_id: number | null;
	name: string | null;
	task_view: "list" | "grid";
};

export type SessionData = {
	id: string;
	user_id: string;
	expires_at: number;
	access_token: string | null;
	fresh: boolean;
};

export type SessionValidationResult = {
	user: SessionUser;
	session: SessionData;
};

export type AuthError = { kind: "session_not_found" } | { kind: "session_expired" } | { kind: "not_found"; resource: string; user_id: string } | { kind: "invalid_state" } | { kind: "db_error"; message: string };

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_REFRESH_THRESHOLD_MS = 15 * 24 * 60 * 60 * 1000;

export function generateSessionId(): string {
	return crypto.randomUUID();
}

export async function createSession(db: any, user_id: string, access_token: string): Promise<Result<SessionData, AuthError>> {
	const session_id = generateSessionId();
	const expires_at = Math.floor((Date.now() + SESSION_DURATION_MS) / 1000);

	const result = await db
		.insert(session)
		.values({
			id: session_id,
			userId: user_id,
			expiresAt: expires_at,
			access_token,
		})
		.returning()
		.catch((e: Error) => e);

	if (result instanceof Error) return err({ kind: "db_error", message: result.message });

	return ok({
		id: session_id,
		user_id,
		expires_at,
		access_token,
		fresh: true,
	});
}

export async function validateSession(db: any, session_id: string): Promise<Result<SessionValidationResult, AuthError>> {
	const rows = await db
		.select({
			session_id: session.id,
			session_user_id: session.userId,
			session_expires_at: session.expiresAt,
			session_access_token: session.access_token,
			user_id: user.id,
			user_github_id: user.github_id,
			user_name: user.name,
			user_task_view: user.task_view,
		})
		.from(session)
		.innerJoin(user, eq(session.userId, user.id))
		.where(eq(session.id, session_id))
		.catch((e: Error) => e);

	if (rows instanceof Error) return err({ kind: "db_error", message: rows.message });

	if (!rows || rows.length === 0) return err({ kind: "session_not_found" });

	const row = rows[0];
	const now_seconds = Math.floor(Date.now() / 1000);

	if (row.session_expires_at <= now_seconds) {
		await invalidateSession(db, session_id);
		return err({ kind: "session_expired" });
	}

	const remaining_ms = (row.session_expires_at - now_seconds) * 1000;
	const is_fresh = remaining_ms < SESSION_REFRESH_THRESHOLD_MS;

	if (is_fresh) {
		const new_expires_at = Math.floor((Date.now() + SESSION_DURATION_MS) / 1000);
		await db
			.update(session)
			.set({ expiresAt: new_expires_at })
			.where(eq(session.id, session_id))
			.catch(() => {});

		return ok({
			user: {
				id: row.user_id,
				github_id: row.user_github_id,
				name: row.user_name,
				task_view: row.user_task_view,
			},
			session: {
				id: row.session_id,
				user_id: row.session_user_id,
				expires_at: new_expires_at,
				access_token: row.session_access_token,
				fresh: true,
			},
		});
	}

	return ok({
		user: {
			id: row.user_id,
			github_id: row.user_github_id,
			name: row.user_name,
			task_view: row.user_task_view,
		},
		session: {
			id: row.session_id,
			user_id: row.session_user_id,
			expires_at: row.session_expires_at,
			access_token: row.session_access_token,
			fresh: false,
		},
	});
}

export async function invalidateSession(db: any, session_id: string): Promise<Result<void, AuthError>> {
	const result = await db
		.delete(session)
		.where(eq(session.id, session_id))
		.catch((e: Error) => e);

	if (result instanceof Error) return err({ kind: "db_error", message: result.message });

	return ok(undefined);
}

export type CookieConfig = {
	secure: boolean;
	domain?: string;
	same_site: "lax" | "strict" | "none";
};

const COOKIE_NAME = "auth_session";

export function getSessionCookieName(): string {
	return COOKIE_NAME;
}

export function createSessionCookie(session_id: string, config: CookieConfig): string {
	const max_age_seconds = Math.floor(SESSION_DURATION_MS / 1000);
	const parts = [`${COOKIE_NAME}=${session_id}`, "Path=/", "HttpOnly", `SameSite=${capitalize(config.same_site)}`];

	if (config.secure) parts.push("Secure");
	if (config.domain) parts.push(`Domain=${config.domain}`);
	parts.push(`Max-Age=${max_age_seconds}`);

	return parts.join("; ");
}

export function createBlankSessionCookie(config: CookieConfig): string {
	const parts = [`${COOKIE_NAME}=`, "Path=/", "HttpOnly", `SameSite=${capitalize(config.same_site)}`];

	if (config.secure) parts.push("Secure");
	if (config.domain) parts.push(`Domain=${config.domain}`);
	parts.push("Max-Age=0");

	return parts.join("; ");
}

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
