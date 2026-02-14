import type { AppContext as MediaAppContext } from "@devpad/core/services/media";
import { credential, secrets, uuid } from "@devpad/core/services/media";
import { createLogger } from "@devpad/core/utils/logger";
import { accounts, type Platform, PlatformSchema, profiles } from "@devpad/schema/media";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { AppContext } from "../../../bindings.js";
import { badRequest, notFound, serverError } from "../../../utils/response.js";
import { getAuth, getContext } from "./auth-context.js";

const log = createLogger("credentials");

const verifyProfileOwnership = async (ctx: MediaAppContext, profileId: string, userId: string): Promise<boolean> => {
	const profile = await ctx.db.select({ user_id: profiles.user_id }).from(profiles).where(eq(profiles.id, profileId)).get();

	return profile?.user_id === userId;
};

const SaveCredentialsBodySchema = z.object({
	profile_id: z.string().min(1),
	client_id: z.string().min(1),
	client_secret: z.string().min(1),
	redirect_uri: z.string().optional(),
	reddit_username: z.string().optional(),
});

const REDDIT_CLIENT_ID_PATTERN = /^[a-zA-Z0-9_-]{10,30}$/;
const REDDIT_SECRET_MIN_LENGTH = 20;

const validateRedditCredentialsFormat = (clientId: string, clientSecret: string): { valid: true } | { valid: false; error: string } => {
	if (!REDDIT_CLIENT_ID_PATTERN.test(clientId)) {
		return { valid: false, error: "Invalid Reddit client_id format" };
	}
	if (clientSecret.length < REDDIT_SECRET_MIN_LENGTH) {
		return { valid: false, error: "Invalid Reddit client_secret format" };
	}
	return { valid: true };
};

type RedditTokenResponse = {
	access_token: string;
	token_type: string;
	expires_in: number;
	scope: string;
};

type RedditUserResponse = {
	id: string;
	name: string;
};

/**
 * Reddit "script" apps use client credentials grant to get an access token,
 * then use that token to access the API on behalf of the app owner.
 */
const authenticateWithReddit = async (clientId: string, clientSecret: string, username: string, password: string): Promise<{ ok: true; accessToken: string; user: RedditUserResponse } | { ok: false; error: string }> => {
	const auth = btoa(`${clientId}:${clientSecret}`);

	const tokenResponse = await fetch("https://www.reddit.com/api/v1/access_token", {
		method: "POST",
		headers: {
			Authorization: `Basic ${auth}`,
			"Content-Type": "application/x-www-form-urlencoded",
			"User-Agent": "media-timeline/2.0.0",
		},
		body: new URLSearchParams({
			grant_type: "client_credentials",
		}),
	});

	if (!tokenResponse.ok) {
		const errorText = await tokenResponse.text();
		log.error("Reddit token request failed", { status: tokenResponse.status, response: errorText });
		return { ok: false, error: "Invalid Reddit credentials. Please check your Client ID and Secret." };
	}

	const tokenData = (await tokenResponse.json()) as RedditTokenResponse;

	if (!tokenData.access_token) {
		return { ok: false, error: "Failed to get access token from Reddit" };
	}

	return {
		ok: true,
		accessToken: tokenData.access_token,
		user: { id: clientId, name: `app_${clientId.slice(0, 8)}` },
	};
};

/**
 * For Reddit script apps, we authenticate and create an account entry
 * using the client credentials directly (no OAuth redirect needed).
 * The username must be provided since client_credentials grant can't access /me.
 */
const setupRedditAccount = async (ctx: MediaAppContext, profileId: string, clientId: string, clientSecret: string, redditUsername: string): Promise<{ ok: true; accountId: string } | { ok: false; error: string }> => {
	const authResult = await authenticateWithReddit(clientId, clientSecret, "", "");

	if (!authResult.ok) {
		return authResult;
	}

	const now = new Date().toISOString();

	const encryptedToken = await secrets.encrypt(authResult.accessToken, ctx.encryptionKey);
	if (!encryptedToken.ok) {
		return { ok: false, error: "Failed to encrypt token" };
	}

	const existing = await ctx.db
		.select({ id: accounts.id })
		.from(accounts)
		.where(and(eq(accounts.profile_id, profileId), eq(accounts.platform, "reddit")))
		.get();

	if (existing) {
		await ctx.db
			.update(accounts)
			.set({
				platform_user_id: redditUsername,
				platform_username: redditUsername,
				access_token_encrypted: encryptedToken.value,
				is_active: true,
				updated_at: now,
			})
			.where(eq(accounts.id, existing.id));

		return { ok: true, accountId: existing.id };
	}

	const accountId = uuid();
	await ctx.db.insert(accounts).values({
		id: accountId,
		profile_id: profileId,
		platform: "reddit",
		platform_user_id: redditUsername,
		platform_username: redditUsername,
		access_token_encrypted: encryptedToken.value,
		refresh_token_encrypted: null,
		token_expires_at: null,
		is_active: true,
		created_at: now,
		updated_at: now,
	});

	return { ok: true, accountId };
};

export const credentialRoutes = new Hono<AppContext>();

credentialRoutes.get("/:platform", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const platformResult = PlatformSchema.safeParse(c.req.param("platform"));
	const profileId = c.req.query("profile_id");

	if (!platformResult.success) {
		return badRequest(c, "Invalid platform");
	}

	if (!profileId) {
		return badRequest(c, "profile_id is required");
	}

	const isOwner = await verifyProfileOwnership(ctx, profileId, auth.user_id);
	if (!isOwner) {
		return notFound(c, "Profile not found");
	}

	const platform = platformResult.data as Platform;
	const hasCredentials = await credential.exists(ctx, profileId, platform);
	const credentials = hasCredentials ? await credential.get(ctx, profileId, platform) : null;

	return c.json({
		exists: hasCredentials,
		isVerified: credentials?.isVerified ?? false,
		clientId: credentials?.clientId ?? null,
	});
});

credentialRoutes.post("/:platform", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const platformResult = PlatformSchema.safeParse(c.req.param("platform"));

	if (!platformResult.success) {
		return badRequest(c, "Invalid platform");
	}

	const body = await c.req.json().catch(() => ({}));
	const parseResult = SaveCredentialsBodySchema.safeParse(body);

	if (!parseResult.success) {
		return badRequest(c, "profile_id, client_id, and client_secret are required", parseResult.error.flatten());
	}

	const { profile_id, client_id, client_secret, redirect_uri } = parseResult.data;

	const isOwner = await verifyProfileOwnership(ctx, profile_id, auth.user_id);
	if (!isOwner) {
		return notFound(c, "Profile not found");
	}

	const platform = platformResult.data as Platform;

	if (platform === "reddit") {
		const { reddit_username } = parseResult.data;

		if (!reddit_username?.trim()) {
			return badRequest(c, "Reddit username is required for BYO credentials");
		}

		const validation = validateRedditCredentialsFormat(client_id, client_secret);
		if (!validation.valid) {
			return badRequest(c, validation.error);
		}

		try {
			const saveResult = await credential.save(ctx, {
				profileId: profile_id,
				platform,
				clientId: client_id,
				clientSecret: client_secret,
				redirectUri: redirect_uri,
			});

			const setupResult = await setupRedditAccount(ctx, profile_id, client_id, client_secret, reddit_username.trim());

			if (!setupResult.ok) {
				await credential.delete(ctx, profile_id, platform);
				return badRequest(c, setupResult.error);
			}

			await credential.verify(ctx, profile_id, platform);

			return c.json({
				success: true,
				id: saveResult.id,
				accountId: setupResult.accountId,
				message: "Reddit connected successfully!",
			});
		} catch (error) {
			log.error("Reddit setup failed", { error });
			return serverError(c, "Failed to setup Reddit connection");
		}
	}

	try {
		const result = await credential.save(ctx, {
			profileId: profile_id,
			platform,
			clientId: client_id,
			clientSecret: client_secret,
			redirectUri: redirect_uri,
		});

		return c.json({
			success: true,
			id: result.id,
			message: `Credentials saved. Click 'Connect with ${platform.charAt(0).toUpperCase() + platform.slice(1)}' to complete setup.`,
		});
	} catch (error) {
		log.error("Failed to save credentials", { error });
		return serverError(c, "Failed to save credentials");
	}
});

credentialRoutes.delete("/:platform", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const platformResult = PlatformSchema.safeParse(c.req.param("platform"));
	const profileId = c.req.query("profile_id");

	if (!platformResult.success) {
		return badRequest(c, "Invalid platform");
	}

	if (!profileId) {
		return badRequest(c, "profile_id is required");
	}

	const isOwner = await verifyProfileOwnership(ctx, profileId, auth.user_id);
	if (!isOwner) {
		return notFound(c, "Profile not found");
	}

	const platform = platformResult.data as Platform;
	const deleted = await credential.delete(ctx, profileId, platform);

	return c.json({
		success: deleted,
		message: deleted ? "Credentials deleted" : "No credentials found",
	});
});
