import type { Database, AppContext as MediaAppContext } from "@devpad/core/services/media";
import { secrets, uuid } from "@devpad/core/services/media";
import { createLogger } from "@devpad/core/utils/logger";
import { accounts, apiKeys, type BadRequestError, errors, type ParseError, type Platform, profiles } from "@devpad/schema/media";
import { err, type FetchError, ok, pipe, type Result, to_nullable, try_catch, try_catch_async } from "@f0rbit/corpus";
import { and, eq, or } from "drizzle-orm";
import type { Context } from "hono";
import type { AppContext } from "../../../bindings.js";
import { getContext } from "./auth-context.js";

type HonoContext = Context<AppContext>;

export type OAuthStateBase = { user_id: string; profile_id: string; nonce: string };
export type OAuthState<T extends Record<string, unknown> = Record<string, never>> = OAuthStateBase & T;

export type TokenResponse = {
	access_token: string;
	refresh_token?: string;
	expires_in?: number;
	token_type: string;
	scope: string;
};

export type DecodeStateError = BadRequestError | ParseError;
export type TokenValidationError = BadRequestError;

export type ValidatedTokens = {
	access_token: string;
	refresh_token?: string;
	expires_in?: number;
	token_type: string;
	scope?: string;
};

export const decodeOAuthStateData = <T extends Record<string, unknown>>(state: string | undefined, requiredKeys: (keyof T)[] = []): Result<OAuthState<T>, DecodeStateError> => {
	if (!state) return errors.badRequest("Missing state parameter");

	const base64Result = try_catch(
		() => atob(state),
		(): ParseError => ({ kind: "parse_error", message: "Invalid base64 in OAuth state" })
	);
	if (!base64Result.ok) return base64Result;

	const jsonResult = try_catch(
		() => JSON.parse(base64Result.value) as OAuthState<T>,
		(): ParseError => ({ kind: "parse_error", message: "Invalid JSON in OAuth state" })
	);
	if (!jsonResult.ok) return jsonResult;

	const stateData = jsonResult.value;

	if (!stateData.user_id) return errors.badRequest("Missing user_id in OAuth state");
	if (!stateData.profile_id) return errors.badRequest("Missing profile_id in OAuth state");

	for (const key of requiredKeys) {
		if (!stateData[key]) return errors.badRequest(`Missing required OAuth key: ${String(key)}`);
	}

	return ok(stateData);
};

export const calculateTokenExpiry = (expiresIn: number | undefined, now: Date = new Date()): string | null => (expiresIn ? new Date(now.getTime() + expiresIn * 1000).toISOString() : null);

export const validateTokenResponse = (response: unknown): Result<ValidatedTokens, TokenValidationError> => {
	if (typeof response !== "object" || response === null) {
		return errors.badRequest("Missing access_token in OAuth response");
	}

	const obj = response as Record<string, unknown>;

	if (typeof obj.access_token !== "string" || obj.access_token === "") {
		return errors.badRequest("Missing access_token in OAuth response");
	}

	if (obj.token_type !== undefined && typeof obj.token_type !== "string") {
		return errors.badRequest(`Invalid token_type: expected Bearer, got ${String(obj.token_type)}`);
	}

	const tokenType = (obj.token_type as string) || "Bearer";
	const normalizedTokenType = tokenType.toLowerCase();
	if (normalizedTokenType !== "bearer" && normalizedTokenType !== "mac") {
		return errors.badRequest(`Invalid token_type: expected Bearer, got ${tokenType}`);
	}

	return ok({
		access_token: obj.access_token,
		refresh_token: typeof obj.refresh_token === "string" ? obj.refresh_token : undefined,
		expires_in: typeof obj.expires_in === "number" ? obj.expires_in : undefined,
		token_type: tokenType,
		scope: typeof obj.scope === "string" ? obj.scope : undefined,
	});
};

export type OAuthUser = {
	id: string;
	username: string;
};

export type OAuthError = { kind: "token_exchange_failed"; message: string } | { kind: "user_fetch_failed"; message: string } | { kind: "encryption_failed"; message: string } | { kind: "db_error"; message: string };

export type OAuthSecrets = { clientId: string | undefined; clientSecret: string | undefined };

export type OAuthCallbackConfig<TState extends Record<string, unknown> = Record<string, never>> = {
	platform: Platform;
	tokenUrl: string;
	tokenAuthHeader: (clientId: string, clientSecret: string) => string;
	tokenHeaders?: Record<string, string>;
	tokenBody: (code: string, redirectUri: string, state: OAuthState<TState>, secrets: { clientId: string; clientSecret: string }) => URLSearchParams;
	fetchUser: (accessToken: string) => Promise<OAuthUser>;
	getSecrets: (env: HonoContext["env"]) => OAuthSecrets;
	stateKeys?: (keyof TState)[];
	resolveSecrets?: (ctx: MediaAppContext, state: OAuthState<TState>, envSecrets: OAuthSecrets) => Promise<OAuthSecrets>;
	onSuccess?: (ctx: MediaAppContext, state: OAuthState<TState>) => Promise<void>;
};

export const getFrontendUrl = (c: HonoContext): string => c.env.FRONTEND_URL || "http://localhost:4321";

export const validateOAuthQueryKey = async (c: HonoContext, ctx: MediaAppContext, platform: string): Promise<Result<string, Response>> => {
	const apiKey = c.req.query("key");
	if (!apiKey) {
		return err(c.redirect(`${getFrontendUrl(c)}/connections?error=${platform}_no_auth`));
	}

	const keyHash = await secrets.key(apiKey);
	const keyResult = await ctx.db.select({ user_id: apiKeys.user_id }).from(apiKeys).where(eq(apiKeys.key_hash, keyHash)).get();

	if (!keyResult) {
		return err(c.redirect(`${getFrontendUrl(c)}/connections?error=${platform}_invalid_auth`));
	}

	return ok(keyResult.user_id);
};

export type OAuthKeyAndProfileResult = { user_id: string; profile_id: string };

export const validateOAuthQueryKeyAndProfile = async (c: HonoContext, ctx: MediaAppContext, platform: string): Promise<Result<OAuthKeyAndProfileResult, Response>> => {
	const profileIdOrSlug = c.req.query("profile_id") || c.req.query("profile");

	const apiKey = c.req.query("key");
	if (apiKey) {
		if (!profileIdOrSlug) {
			return err(c.redirect(`${getFrontendUrl(c)}/connections?error=${platform}_no_profile`));
		}

		const keyHash = await secrets.key(apiKey);
		const keyResult = await ctx.db.select({ user_id: apiKeys.user_id }).from(apiKeys).where(eq(apiKeys.key_hash, keyHash)).get();

		if (!keyResult) {
			return err(c.redirect(`${getFrontendUrl(c)}/connections?error=${platform}_invalid_auth`));
		}

		const profile = await ctx.db
			.select({ id: profiles.id, user_id: profiles.user_id })
			.from(profiles)
			.where(and(eq(profiles.user_id, keyResult.user_id), or(eq(profiles.id, profileIdOrSlug), eq(profiles.slug, profileIdOrSlug))))
			.get();

		if (!profile) {
			return err(c.redirect(`${getFrontendUrl(c)}/connections?error=${platform}_invalid_profile`));
		}

		return ok({ user_id: keyResult.user_id, profile_id: profile.id });
	}

	const user = c.get("user");
	const auth = user ? { user_id: user.id, name: user.name, email: null, image_url: null } : null;
	if (auth?.user_id) {
		if (!profileIdOrSlug) {
			return err(c.redirect(`${getFrontendUrl(c)}/connections?error=${platform}_no_profile`));
		}

		const profile = await ctx.db
			.select({ id: profiles.id, user_id: profiles.user_id })
			.from(profiles)
			.where(and(eq(profiles.user_id, auth.user_id), or(eq(profiles.id, profileIdOrSlug), eq(profiles.slug, profileIdOrSlug))))
			.get();

		if (profile) {
			return ok({ user_id: auth.user_id, profile_id: profile.id });
		}

		return err(c.redirect(`${getFrontendUrl(c)}/connections?error=${platform}_invalid_profile`));
	}

	return err(c.redirect(`${getFrontendUrl(c)}/connections?error=${platform}_no_auth`));
};

export const redirectWithError = (c: HonoContext, platform: Platform, errorCode: string): Response => c.redirect(`${getFrontendUrl(c)}/connections?error=${platform}_${errorCode}`);

export const redirectWithSuccess = (c: HonoContext, platform: Platform): Response => c.redirect(`${getFrontendUrl(c)}/connections?success=${platform}`);

export const encodeOAuthState = <T extends Record<string, unknown>>(userId: string, profileId: string, extra?: T): string => {
	const stateData: OAuthState<T> = {
		user_id: userId,
		profile_id: profileId,
		nonce: uuid(),
		...(extra as T),
	};
	return btoa(JSON.stringify(stateData));
};

export const decodeOAuthState = <T extends Record<string, unknown> = Record<string, never>>(c: HonoContext, state: string | undefined, platform: Platform, requiredKeys: (keyof T)[] = []): Result<OAuthState<T>, Response> => {
	const result = decodeOAuthStateData<T>(state, requiredKeys);

	if (!result.ok) {
		const isNoState = result.error.kind === "bad_request" && result.error.message === "Missing state parameter";
		const errorCode = isNoState ? "no_state" : "invalid_state";
		if (!isNoState) {
			const log = createLogger(`oauth:${platform}`);
			log.error("Invalid state parameter");
		}
		return err(redirectWithError(c, platform, errorCode));
	}

	return ok(result.value);
};

export type ValidatedOAuthRequest<TState extends Record<string, unknown>> = {
	code: string;
	stateData: OAuthState<TState>;
	redirectUri: string;
	clientId: string;
	clientSecret: string;
};

export const validateOAuthRequest = async <TState extends Record<string, unknown>>(c: HonoContext, ctx: MediaAppContext, config: OAuthCallbackConfig<TState>): Promise<Result<ValidatedOAuthRequest<TState>, Response>> => {
	const log = createLogger(`oauth:${config.platform}`);
	const code = c.req.query("code");
	const error = c.req.query("error");

	if (error) {
		log.error("Authorization denied:", error);
		return err(redirectWithError(c, config.platform, "auth_denied"));
	}

	if (!code) {
		return err(redirectWithError(c, config.platform, "no_code"));
	}

	const stateResult = decodeOAuthState<TState>(c, c.req.query("state"), config.platform, config.stateKeys);
	if (!stateResult.ok) return err(stateResult.error);

	const envSecrets = config.getSecrets(c.env);
	const { clientId, clientSecret } = config.resolveSecrets ? await config.resolveSecrets(ctx, stateResult.value, envSecrets) : envSecrets;

	const redirectUri = `${c.env.API_URL || "http://localhost:8787"}/api/auth/platforms/${config.platform}/callback`;

	if (!clientId || !clientSecret) {
		return err(redirectWithError(c, config.platform, "not_configured"));
	}

	return ok({ code, stateData: stateResult.value, redirectUri, clientId, clientSecret });
};

const mapTokenExchangeError = (e: FetchError): OAuthError => ({
	kind: "token_exchange_failed",
	message: e.type === "http" ? `Token exchange failed: HTTP ${e.status}` : String(e.cause),
});

export const exchangeCodeForTokens = <TState extends Record<string, unknown>>(
	code: string,
	redirectUri: string,
	clientId: string,
	clientSecret: string,
	config: OAuthCallbackConfig<TState>,
	stateData: OAuthState<TState>
): Promise<Result<TokenResponse, OAuthError>> =>
	pipe
		.fetch<TokenResponse, OAuthError>(
			config.tokenUrl,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
					Authorization: config.tokenAuthHeader(clientId, clientSecret),
					...config.tokenHeaders,
				},
				body: config.tokenBody(code, redirectUri, stateData, { clientId, clientSecret }),
			},
			mapTokenExchangeError
		)
		.result();

export const fetchOAuthUserProfile = async <TState extends Record<string, unknown>>(accessToken: string, config: OAuthCallbackConfig<TState>): Promise<Result<OAuthUser, OAuthError>> =>
	try_catch_async(
		() => config.fetchUser(accessToken),
		(e): OAuthError => ({ kind: "user_fetch_failed", message: String(e) })
	);

type EncryptedTokens = {
	encryptedAccessToken: string;
	encryptedRefreshToken: string | null;
};

export const encryptTokens = (tokens: TokenResponse, encryptionKey: string): Promise<Result<EncryptedTokens, OAuthError>> =>
	pipe(secrets.encrypt(tokens.access_token, encryptionKey))
		.map_err((): OAuthError => ({ kind: "encryption_failed", message: "Failed to encrypt access token" }))
		.flat_map(async encryptedAccessToken => {
			const encryptedRefreshToken = tokens.refresh_token ? to_nullable(await secrets.encrypt(tokens.refresh_token, encryptionKey)) : null;
			return ok({ encryptedAccessToken, encryptedRefreshToken });
		})
		.result();

export const upsertOAuthAccount = (db: Database, encryptionKey: string, profileId: string, platform: Platform, user: OAuthUser, tokens: TokenResponse): Promise<Result<string, OAuthError>> =>
	pipe(encryptTokens(tokens, encryptionKey))
		.flat_map(async ({ encryptedAccessToken, encryptedRefreshToken }) => {
			const nowDate = new Date();
			const now = nowDate.toISOString();
			const tokenExpiresAt = calculateTokenExpiry(tokens.expires_in, nowDate);

			const existing = await db
				.select()
				.from(accounts)
				.where(and(eq(accounts.profile_id, profileId), eq(accounts.platform, platform), eq(accounts.platform_user_id, user.id)))
				.get();

			if (existing) {
				return updateExistingAccount(db, existing.id, encryptedAccessToken, encryptedRefreshToken, tokenExpiresAt, now);
			}

			return createNewAccount(db, profileId, platform, user, encryptedAccessToken, encryptedRefreshToken, tokenExpiresAt, now);
		})
		.result();

const updateExistingAccount = async (db: Database, accountId: string, encryptedAccessToken: string, encryptedRefreshToken: string | null, tokenExpiresAt: string | null, now: string): Promise<Result<string, OAuthError>> => {
	await db
		.update(accounts)
		.set({
			access_token_encrypted: encryptedAccessToken,
			refresh_token_encrypted: encryptedRefreshToken,
			token_expires_at: tokenExpiresAt,
			is_active: true,
			updated_at: now,
		})
		.where(eq(accounts.id, accountId));

	return ok(accountId);
};

const createNewAccount = async (
	db: Database,
	profileId: string,
	platform: Platform,
	user: OAuthUser,
	encryptedAccessToken: string,
	encryptedRefreshToken: string | null,
	tokenExpiresAt: string | null,
	now: string
): Promise<Result<string, OAuthError>> => {
	const accountId = uuid();

	await db.insert(accounts).values({
		id: accountId,
		profile_id: profileId,
		platform,
		platform_user_id: user.id,
		platform_username: user.username,
		access_token_encrypted: encryptedAccessToken,
		refresh_token_encrypted: encryptedRefreshToken,
		token_expires_at: tokenExpiresAt,
		is_active: true,
		created_at: now,
		updated_at: now,
	});

	return ok(accountId);
};

type OAuthCallbackError = OAuthError & { errorCode: string };

const toCallbackError = (error: OAuthError, errorCode: string): OAuthCallbackError => ({ ...error, errorCode });

export const createOAuthCallback = <TState extends Record<string, unknown> = Record<string, never>>(config: OAuthCallbackConfig<TState>) => {
	return async (c: HonoContext) => {
		const ctx = getContext(c);

		const log = createLogger(`oauth:${config.platform}`);
		const validation = await validateOAuthRequest(c, ctx, config);
		if (!validation.ok) return validation.error;

		const { code, stateData, redirectUri, clientId, clientSecret } = validation.value;

		const result = await pipe(exchangeCodeForTokens(code, redirectUri, clientId, clientSecret, config, stateData))
			.map_err(e => toCallbackError(e, "token_failed"))
			.tap_err(e => log.error("Token exchange failed:", e.message))
			.flat_map(tokens =>
				pipe(fetchOAuthUserProfile(tokens.access_token, config))
					.map_err(e => toCallbackError(e, "user_failed"))
					.map(user => ({ tokens, user }))
					.result()
			)
			.tap_err(e => log.error("Failed to get user info:", e.message))
			.flat_map(({ tokens, user }) =>
				pipe(upsertOAuthAccount(ctx.db, ctx.encryptionKey, stateData.profile_id, config.platform, user, tokens))
					.map_err(e => toCallbackError(e, "save_failed"))
					.result()
			)
			.tap_err(e => log.error("Failed to save account:", e.message))
			.result();

		if (!result.ok) {
			return redirectWithError(c, config.platform, result.error.errorCode);
		}

		if (config.onSuccess) {
			await config.onSuccess(ctx, stateData);
		}

		return redirectWithSuccess(c, config.platform);
	};
};

export const oauth = {
	encode: encodeOAuthState,
	decode: decodeOAuthState,
	validate: validateOAuthRequest,
	exchange: exchangeCodeForTokens,
	callback: createOAuthCallback,
	upsert: upsertOAuthAccount,
	url: getFrontendUrl,
	redirect: {
		error: redirectWithError,
		success: redirectWithSuccess,
	},
	state: {
		decode: decodeOAuthStateData,
	},
	token: {
		validate: validateTokenResponse,
		expiry: calculateTokenExpiry,
		encrypt: encryptTokens,
	},
	user: {
		fetch: fetchOAuthUserProfile,
	},
	query: {
		key: validateOAuthQueryKey,
		profile: validateOAuthQueryKeyAndProfile,
	},
};
