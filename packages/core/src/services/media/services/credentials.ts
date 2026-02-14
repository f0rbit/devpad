import { type Platform, platformCredentials } from "@devpad/schema/media";
import { and, eq } from "drizzle-orm";
import type { AppContext } from "../context";
import { secrets, uuid } from "../utils";

export type CredentialInput = {
	profileId: string;
	platform: Platform;
	clientId: string;
	clientSecret: string;
	redirectUri?: string;
	metadata?: Record<string, unknown>;
};

export type DecryptedCredentials = {
	id: string;
	profileId: string;
	platform: Platform;
	clientId: string;
	clientSecret: string;
	redirectUri: string | null;
	metadata: Record<string, unknown> | null;
	isVerified: boolean;
};

const save = async (ctx: AppContext, input: CredentialInput): Promise<{ id: string }> => {
	const { profileId, platform, clientId, clientSecret, redirectUri, metadata } = input;

	const encryptResult = await secrets.encrypt(clientSecret, ctx.encryptionKey);
	if (!encryptResult.ok) {
		throw new Error("Failed to encrypt client secret");
	}

	const now = new Date().toISOString();

	const existing = await ctx.db
		.select({ id: platformCredentials.id })
		.from(platformCredentials)
		.where(and(eq(platformCredentials.profile_id, profileId), eq(platformCredentials.platform, platform)))
		.get();

	if (existing) {
		await ctx.db
			.update(platformCredentials)
			.set({
				client_id: clientId,
				client_secret_encrypted: encryptResult.value,
				redirect_uri: redirectUri ?? null,
				metadata: metadata ? JSON.stringify(metadata) : null,
				is_verified: false,
				updated_at: now,
			})
			.where(eq(platformCredentials.id, existing.id));

		return { id: existing.id };
	}

	const id = uuid();
	await ctx.db.insert(platformCredentials).values({
		id,
		profile_id: profileId,
		platform,
		client_id: clientId,
		client_secret_encrypted: encryptResult.value,
		redirect_uri: redirectUri ?? null,
		metadata: metadata ? JSON.stringify(metadata) : null,
		is_verified: false,
		created_at: now,
		updated_at: now,
	});

	return { id };
};

const get = async (ctx: AppContext, profileId: string, platform: Platform): Promise<DecryptedCredentials | null> => {
	const row = await ctx.db
		.select()
		.from(platformCredentials)
		.where(and(eq(platformCredentials.profile_id, profileId), eq(platformCredentials.platform, platform)))
		.get();

	if (!row) {
		return null;
	}

	const decryptResult = await secrets.decrypt(row.client_secret_encrypted, ctx.encryptionKey);
	if (!decryptResult.ok) {
		throw new Error("Failed to decrypt client secret");
	}

	return {
		id: row.id,
		profileId: row.profile_id,
		platform: row.platform as Platform,
		clientId: row.client_id,
		clientSecret: decryptResult.value,
		redirectUri: row.redirect_uri,
		metadata: row.metadata ? JSON.parse(row.metadata) : null,
		isVerified: row.is_verified ?? false,
	};
};

const remove = async (ctx: AppContext, profileId: string, platform: Platform): Promise<boolean> => {
	const existing = await ctx.db
		.select({ id: platformCredentials.id })
		.from(platformCredentials)
		.where(and(eq(platformCredentials.profile_id, profileId), eq(platformCredentials.platform, platform)))
		.get();

	if (!existing) {
		return false;
	}

	await ctx.db.delete(platformCredentials).where(eq(platformCredentials.id, existing.id));

	return true;
};

const verify = async (ctx: AppContext, profileId: string, platform: Platform): Promise<void> => {
	await ctx.db
		.update(platformCredentials)
		.set({
			is_verified: true,
			updated_at: new Date().toISOString(),
		})
		.where(and(eq(platformCredentials.profile_id, profileId), eq(platformCredentials.platform, platform)));
};

const exists = async (ctx: AppContext, profileId: string, platform: Platform): Promise<boolean> => {
	const row = await ctx.db
		.select({ id: platformCredentials.id })
		.from(platformCredentials)
		.where(and(eq(platformCredentials.profile_id, profileId), eq(platformCredentials.platform, platform)))
		.get();

	return !!row;
};

export const credential = {
	save,
	get,
	delete: remove,
	verify,
	exists,
};
