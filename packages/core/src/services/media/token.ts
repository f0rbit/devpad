import type { BadRequestError } from "@devpad/schema/media";
import { errors } from "@devpad/schema/media";
import type { FetchError, Result } from "@f0rbit/corpus";
import { ok, pipe, to_nullable } from "@f0rbit/corpus";
import { secrets } from "./utils";

type OAuthTokenResponse = { access_token: string; refresh_token?: string; expires_in: number };
type TokenValidationError = BadRequestError;

type ValidatedTokens = {
	access_token: string;
	refresh_token?: string;
	expires_in?: number;
	token_type: string;
	scope?: string;
};

type TokenResponse = {
	access_token: string;
	refresh_token?: string;
	expires_in?: number;
	token_type: string;
	scope: string;
};

type OAuthError = { kind: "encryption_failed"; message: string };

type EncryptedTokens = {
	encryptedAccessToken: string;
	encryptedRefreshToken: string | null;
};

const validate = (response: unknown): Result<ValidatedTokens, TokenValidationError> => {
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

const expiry = (expiresIn: number | undefined, now: Date = new Date()): string | null => (expiresIn ? new Date(now.getTime() + expiresIn * 1000).toISOString() : null);

const encryptPair = (tokens: TokenResponse, encryptionKey: string): Promise<Result<EncryptedTokens, OAuthError>> =>
	pipe(secrets.encrypt(tokens.access_token, encryptionKey))
		.map_err((): OAuthError => ({ kind: "encryption_failed", message: "Failed to encrypt access token" }))
		.flat_map(async encryptedAccessToken => {
			const encryptedRefreshToken = tokens.refresh_token ? to_nullable(await secrets.encrypt(tokens.refresh_token, encryptionKey)) : null;
			return ok({ encryptedAccessToken, encryptedRefreshToken });
		})
		.result();

const redditRefresh = (refreshToken: string, clientId: string, clientSecret: string): Promise<Result<OAuthTokenResponse, FetchError>> =>
	pipe
		.fetch<OAuthTokenResponse, FetchError>(
			"https://www.reddit.com/api/v1/access_token",
			{
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
					Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
					"User-Agent": "media-timeline/2.0.0",
				},
				body: new URLSearchParams({
					grant_type: "refresh_token",
					refresh_token: refreshToken,
				}),
			},
			e => e
		)
		.result();

const twitterRefresh = (refreshToken: string, clientId: string, clientSecret: string): Promise<Result<OAuthTokenResponse, FetchError>> =>
	pipe
		.fetch<OAuthTokenResponse, FetchError>(
			"https://api.twitter.com/2/oauth2/token",
			{
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
					Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
				},
				body: new URLSearchParams({
					grant_type: "refresh_token",
					refresh_token: refreshToken,
					client_id: clientId,
				}),
			},
			e => e
		)
		.result();

export const token = {
	validate,
	expiry,
	encrypt: encryptPair,
	reddit: {
		refresh: redditRefresh,
	},
	twitter: {
		refresh: twitterRefresh,
	},
};

export type { ValidatedTokens, TokenValidationError, TokenResponse, EncryptedTokens, OAuthError as TokenEncryptionError };
