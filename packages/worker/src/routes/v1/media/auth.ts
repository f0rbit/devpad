import type { AppContext as MediaAppContext } from "@devpad/core/services/media";
import { credential, token } from "@devpad/core/services/media";
import { Hono } from "hono";
import type { AppContext } from "../../../bindings.js";
import { getContext } from "./auth-context.js";
import { type OAuthCallbackConfig, type OAuthState, oauth, type PlatformSecrets } from "./oauth-helpers.js";

type RedditOAuthState = { byo?: boolean };

const resolveRedditSecrets = async (ctx: MediaAppContext, state: OAuthState<RedditOAuthState>, envSecrets: PlatformSecrets): Promise<PlatformSecrets> => {
	if (!state.byo) return envSecrets;
	const byoCredentials = await credential.get(ctx, state.profile_id, "reddit");
	if (!byoCredentials) return { clientId: undefined, clientSecret: undefined };
	return { clientId: byoCredentials.clientId, clientSecret: byoCredentials.clientSecret };
};

const onRedditSuccess = async (ctx: MediaAppContext, state: OAuthState<RedditOAuthState>): Promise<void> => {
	if (state.byo) {
		await credential.verify(ctx, state.profile_id, "reddit");
	}
};

const redditOAuthConfig: OAuthCallbackConfig<RedditOAuthState> = {
	platform: "reddit",
	tokenUrl: "https://www.reddit.com/api/v1/access_token",
	tokenAuthHeader: (id, secret) => `Basic ${btoa(`${id}:${secret}`)}`,
	tokenHeaders: { "User-Agent": "media-timeline/2.0.0" },
	tokenBody: (code, redirectUri, _state, _secrets) =>
		new URLSearchParams({
			grant_type: "authorization_code",
			code,
			redirect_uri: redirectUri,
		}),
	fetchUser: async (accessToken): Promise<{ id: string; username: string }> => {
		const response = await fetch("https://oauth.reddit.com/api/v1/me", {
			headers: {
				Authorization: `Bearer ${accessToken}`,
				"User-Agent": "media-timeline/2.0.0",
			},
		});
		if (!response.ok) throw new Error(`User fetch failed: ${response.status}`);
		const data = (await response.json()) as { id: string; name: string };
		return { id: data.id, username: data.name };
	},
	getSecrets: secrets => ({ clientId: secrets.reddit_client_id, clientSecret: secrets.reddit_client_secret }),
	resolveSecrets: resolveRedditSecrets,
	onSuccess: onRedditSuccess,
};

const twitterOAuthConfig: OAuthCallbackConfig<{ code_verifier: string }> = {
	platform: "twitter",
	tokenUrl: "https://api.twitter.com/2/oauth2/token",
	tokenAuthHeader: (id, secret) => `Basic ${btoa(`${id}:${secret}`)}`,
	tokenBody: (code, redirectUri, state, _secrets) =>
		new URLSearchParams({
			grant_type: "authorization_code",
			code,
			redirect_uri: redirectUri,
			code_verifier: state.code_verifier,
		}),
	fetchUser: async (accessToken): Promise<{ id: string; username: string }> => {
		const response = await fetch("https://api.twitter.com/2/users/me", {
			headers: { Authorization: `Bearer ${accessToken}` },
		});
		if (!response.ok) throw new Error(`User fetch failed: ${response.status}`);
		const data = (await response.json()) as { data: { id: string; username: string } };
		return { id: data.data.id, username: data.data.username };
	},
	getSecrets: secrets => ({ clientId: secrets.twitter_client_id, clientSecret: secrets.twitter_client_secret }),
	stateKeys: ["code_verifier"],
};

const githubOAuthConfig: OAuthCallbackConfig = {
	platform: "github",
	tokenUrl: "https://github.com/login/oauth/access_token",
	tokenAuthHeader: () => "",
	tokenHeaders: { Accept: "application/json" },
	tokenBody: (code, redirectUri, _state, secrets) =>
		new URLSearchParams({
			client_id: secrets.clientId,
			client_secret: secrets.clientSecret,
			code,
			redirect_uri: redirectUri,
		}),
	fetchUser: async (accessToken): Promise<{ id: string; username: string }> => {
		const response = await fetch("https://api.github.com/user", {
			headers: {
				Authorization: `Bearer ${accessToken}`,
				Accept: "application/json",
				"User-Agent": "media-timeline/2.0.0",
			},
		});
		if (!response.ok) throw new Error(`User fetch failed: ${response.status}`);
		const data = (await response.json()) as { id: number; login: string };
		return { id: String(data.id), username: data.login };
	},
	getSecrets: secrets => ({ clientId: secrets.github_client_id, clientSecret: secrets.github_client_secret }),
};

const base64UrlEncode = (buffer: Uint8Array): string => {
	return btoa(String.fromCharCode(...buffer))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
};

const generateCodeVerifier = (): string => {
	const array = new Uint8Array(32);
	crypto.getRandomValues(array);
	return base64UrlEncode(array);
};

const generateCodeChallenge = async (verifier: string): Promise<string> => {
	const encoder = new TextEncoder();
	const data = encoder.encode(verifier);
	const hash = await crypto.subtle.digest("SHA-256", data);
	return base64UrlEncode(new Uint8Array(hash));
};

export const authRoutes = new Hono<AppContext>();

authRoutes.get("/reddit", async c => {
	const ctx = getContext(c);

	const validation = await oauth.query.profile(c, ctx, "reddit");
	if (!validation.ok) return validation.error;
	const { user_id, profile_id } = validation.value;

	const byoCredentials = await credential.get(ctx, profile_id, "reddit");
	const clientId = byoCredentials?.clientId ?? c.get("oauth_secrets").reddit_client_id;

	if (!clientId) {
		return c.redirect(`${oauth.url(c)}/connections?error=reddit_no_credentials`);
	}

	const redirectUri = `${c.get("config").api_url || "http://localhost:8787"}/api/auth/platforms/reddit/callback`;
	const state = oauth.encode(user_id, profile_id, { byo: !!byoCredentials });

	const authUrl = new URL("https://www.reddit.com/api/v1/authorize");
	authUrl.searchParams.set("client_id", clientId);
	authUrl.searchParams.set("response_type", "code");
	authUrl.searchParams.set("state", state);
	authUrl.searchParams.set("redirect_uri", redirectUri);
	authUrl.searchParams.set("duration", "permanent");
	authUrl.searchParams.set("scope", "identity,history,read");

	return c.redirect(authUrl.toString());
});

authRoutes.get("/reddit/callback", oauth.callback(redditOAuthConfig));

authRoutes.get("/twitter", async c => {
	const ctx = getContext(c);

	const validation = await oauth.query.profile(c, ctx, "twitter");
	if (!validation.ok) return validation.error;
	const { user_id, profile_id } = validation.value;

	const clientId = c.get("oauth_secrets").twitter_client_id;
	if (!clientId) {
		return c.json({ error: "Twitter OAuth not configured" }, 500);
	}

	const redirectUri = `${c.get("config").api_url || "http://localhost:8787"}/api/auth/platforms/twitter/callback`;

	const codeVerifier = generateCodeVerifier();
	const codeChallenge = await generateCodeChallenge(codeVerifier);
	const state = oauth.encode(user_id, profile_id, { code_verifier: codeVerifier });

	const authUrl = new URL("https://twitter.com/i/oauth2/authorize");
	authUrl.searchParams.set("client_id", clientId);
	authUrl.searchParams.set("response_type", "code");
	authUrl.searchParams.set("state", state);
	authUrl.searchParams.set("redirect_uri", redirectUri);
	authUrl.searchParams.set("scope", "tweet.read users.read offline.access");
	authUrl.searchParams.set("code_challenge", codeChallenge);
	authUrl.searchParams.set("code_challenge_method", "S256");

	return c.redirect(authUrl.toString());
});

authRoutes.get("/twitter/callback", oauth.callback(twitterOAuthConfig));

authRoutes.get("/github", async c => {
	const ctx = getContext(c);

	const validation = await oauth.query.profile(c, ctx, "github");
	if (!validation.ok) return validation.error;
	const { user_id, profile_id } = validation.value;

	const clientId = c.get("oauth_secrets").github_client_id;
	if (!clientId) {
		return c.json({ error: "GitHub OAuth not configured" }, 500);
	}

	const redirectUri = `${c.get("config").api_url || "http://localhost:8787"}/api/auth/platforms/github/callback`;
	const state = oauth.encode(user_id, profile_id);

	const authUrl = new URL("https://github.com/login/oauth/authorize");
	authUrl.searchParams.set("client_id", clientId);
	authUrl.searchParams.set("redirect_uri", redirectUri);
	authUrl.searchParams.set("scope", "read:user repo");
	authUrl.searchParams.set("state", state);

	return c.redirect(authUrl.toString());
});

authRoutes.get("/github/callback", oauth.callback(githubOAuthConfig));

export { token };
