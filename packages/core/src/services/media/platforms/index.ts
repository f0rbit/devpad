export { BlueskyMemoryProvider, BlueskyProvider, type BlueskyProviderConfig, normalizeBluesky } from "./bluesky";
export { DevpadMemoryProvider, DevpadProvider, normalizeDevpad } from "./devpad";
export { type GitHubFetchResult, GitHubProvider, type GitHubProviderConfig } from "./github";
export { type GitHubMemoryConfig, GitHubMemoryProvider } from "./github-memory";
export type { MemoryProviderControls, MemoryProviderState, SimulationConfig } from "./memory-base";
export { BaseMemoryProvider, createMemoryProviderControlMethods, createMemoryProviderState, simulateErrors } from "./memory-base";
export * from "./reddit";
export * from "./reddit-memory";
export * from "./twitter";
export * from "./twitter-memory";
export * from "./types";
export { normalizeYouTube, YouTubeMemoryProvider, YouTubeProvider, type YouTubeProviderConfig } from "./youtube";

import type { Database } from "@devpad/schema/database/types";
import { errors } from "@devpad/schema/media";
import type { Result } from "@f0rbit/corpus";
import { BlueskyProvider } from "./bluesky";
import { DevpadProvider } from "./devpad";
import type { Provider, ProviderError, ProviderFactory } from "./types";
import { YouTubeProvider } from "./youtube";

export const createProviderFactory = (db: Database): ProviderFactory => ({
	async create(platform, platformUserId, token) {
		const provider = providerForPlatform(platform, platformUserId, db);
		if (!provider) return errors.badRequest(`Unknown platform: ${platform}`);
		return provider.fetch(token) as Promise<Result<Record<string, unknown>, ProviderError>>;
	},
});

export const defaultProviderFactory: ProviderFactory = {
	async create(platform, platformUserId, token) {
		const provider = providerForPlatform(platform, platformUserId);
		if (!provider) return errors.badRequest(`Unknown platform: ${platform}`);
		return provider.fetch(token) as Promise<Result<Record<string, unknown>, ProviderError>>;
	},
};

const providerForPlatform = (platform: string, platformUserId: string | null, db?: Database): Provider<unknown> | null => {
	switch (platform) {
		case "bluesky":
			return new BlueskyProvider({ actor: platformUserId ?? "" });
		case "youtube":
			return new YouTubeProvider({ playlist_id: platformUserId ?? "" });
		case "devpad":
			if (!db || !platformUserId) return null;
			return new DevpadProvider(db, platformUserId);
		default:
			return null;
	}
};
