import { user } from "@devpad/schema/database/schema";
import { err, ok, type Result } from "@f0rbit/corpus";
import { eq } from "drizzle-orm";
import { createSession } from "./session.js";

export type OAuthError = { kind: "invalid_state" } | { kind: "github_error"; message: string } | { kind: "db_error"; message: string };

export type OAuthEnv = {
	GITHUB_CLIENT_ID: string;
	GITHUB_CLIENT_SECRET: string;
	JWT_SECRET: string;
};

export interface GitHubUser {
	id: number;
	login: string;
	name: string | null;
	email: string | null;
	avatar_url: string;
}

export interface OAuthState {
	url: string;
	state: string;
}

export interface OAuthParams {
	return_to?: string;
	mode?: "jwt" | "session";
}

export interface DecodedOAuthState {
	csrf: string;
	return_to?: string;
	mode?: "jwt" | "session";
}

export interface OAuthCallbackResult {
	user: {
		id: string;
		github_id: number | null;
		name: string | null;
		email: string | null;
		email_verified: string | null;
		image_url: string | null;
		task_view: "list" | "grid";
	};
	accessToken: string;
	sessionId: string;
}

export function createGitHubAuthUrl(env: OAuthEnv, params?: OAuthParams): Result<OAuthState, OAuthError> {
	const csrf_state = crypto.randomUUID();

	const state_data: DecodedOAuthState = {
		csrf: csrf_state,
		return_to: params?.return_to,
		mode: params?.mode,
	};

	const encoded_state = btoa(JSON.stringify(state_data)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

	const url_params = new URLSearchParams({
		client_id: env.GITHUB_CLIENT_ID,
		scope: "user:email repo",
		state: encoded_state,
	});

	const url = `https://github.com/login/oauth/authorize?${url_params.toString()}`;

	return ok({ url, state: encoded_state });
}

export async function handleGitHubCallback(db: any, env: OAuthEnv, code: string, state: string, stored_state: string): Promise<Result<OAuthCallbackResult, OAuthError>> {
	if (state !== stored_state) return err({ kind: "invalid_state" });

	const token_response = await fetch("https://github.com/login/oauth/access_token", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json",
		},
		body: JSON.stringify({
			client_id: env.GITHUB_CLIENT_ID,
			client_secret: env.GITHUB_CLIENT_SECRET,
			code,
		}),
	}).catch((e: Error) => e);

	if (token_response instanceof Error) return err({ kind: "github_error", message: token_response.message });

	if (!token_response.ok) return err({ kind: "github_error", message: `Token exchange failed: ${token_response.status}` });

	const token_data = (await token_response.json()) as { access_token?: string; error?: string };

	if (token_data.error || !token_data.access_token) return err({ kind: "github_error", message: token_data.error ?? "No access token" });

	const access_token = token_data.access_token;

	const github_user_result = await fetchGitHubUser(access_token);
	if (!github_user_result.ok) return github_user_result;

	const github_user = github_user_result.value;
	const db_user_result = await createOrUpdateUser(db, github_user);
	if (!db_user_result.ok) return db_user_result;

	const db_user = db_user_result.value;
	const session_result = await createSession(db, db_user.id, access_token);
	if (!session_result.ok) return err({ kind: "db_error", message: `Session creation failed: ${session_result.error.kind}` });

	return ok({
		user: db_user,
		accessToken: access_token,
		sessionId: session_result.value.id,
	});
}

export function decodeOAuthState(encoded_state: string): Result<DecodedOAuthState, OAuthError> {
	const decoded = (() => {
		try {
			const padded = encoded_state.replace(/-/g, "+").replace(/_/g, "/");
			const pad_length = (4 - (padded.length % 4)) % 4;
			return JSON.parse(atob(padded + "=".repeat(pad_length)));
		} catch {
			return null;
		}
	})();

	if (!decoded) return err({ kind: "invalid_state" });

	return ok(decoded as DecodedOAuthState);
}

async function fetchGitHubUser(access_token: string): Promise<Result<GitHubUser, OAuthError>> {
	const response = await fetch("https://api.github.com/user", {
		headers: {
			Authorization: `Bearer ${access_token}`,
			"User-Agent": "devpad-app",
		},
	}).catch((e: Error) => e);

	if (response instanceof Error) return err({ kind: "github_error", message: response.message });

	if (!response.ok) return err({ kind: "github_error", message: `GitHub API: ${response.status} ${response.statusText}` });

	const user_data = (await response.json()) as any;

	if (!user_data.email) {
		const email_result = await fetchGitHubEmail(access_token);
		if (email_result.ok) user_data.email = email_result.value;
	}

	return ok({
		id: user_data.id,
		login: user_data.login,
		name: user_data.name,
		email: user_data.email,
		avatar_url: user_data.avatar_url,
	});
}

async function fetchGitHubEmail(access_token: string): Promise<Result<string | null, OAuthError>> {
	const response = await fetch("https://api.github.com/user/emails", {
		headers: {
			Authorization: `Bearer ${access_token}`,
			"User-Agent": "devpad-app",
		},
	}).catch((e: Error) => e);

	if (response instanceof Error) return ok(null);
	if (!response.ok) return ok(null);

	const emails = (await response.json()) as Array<{ email: string; primary: boolean }>;
	const primary = emails.find(e => e.primary);
	return ok(primary?.email ?? null);
}

async function createOrUpdateUser(db: any, github_user: GitHubUser): Promise<Result<OAuthCallbackResult["user"], OAuthError>> {
	const existing = await db
		.select()
		.from(user)
		.where(eq(user.github_id, github_user.id))
		.limit(1)
		.catch((e: Error) => e);

	if (existing instanceof Error) return err({ kind: "db_error", message: existing.message });

	if (existing.length > 0) {
		const updated = await db
			.update(user)
			.set({
				name: github_user.name || github_user.login,
				email: github_user.email,
				image_url: github_user.avatar_url,
			})
			.where(eq(user.github_id, github_user.id))
			.returning()
			.catch((e: Error) => e);

		if (updated instanceof Error) return err({ kind: "db_error", message: updated.message });

		return ok(updated[0]);
	}

	const created = await db
		.insert(user)
		.values({
			github_id: github_user.id,
			name: github_user.name || github_user.login,
			email: github_user.email,
			image_url: github_user.avatar_url,
			task_view: "list",
		})
		.returning()
		.catch((e: Error) => e);

	if (created instanceof Error) return err({ kind: "db_error", message: created.message });

	return ok(created[0]);
}
