/// <reference types="@cloudflare/workers-types" />

import type { Bindings } from "@devpad/schema/bindings";
import * as schema from "@devpad/schema/database/media";
import { create_cloudflare_backend } from "@f0rbit/corpus/cloudflare";
import { drizzle } from "drizzle-orm/d1";
import type { AppContext } from "./infrastructure/context";
import type { ProviderFactory } from "./platforms/types";

export type { Bindings } from "@devpad/schema/bindings";

type CorpusBackend = {
	d1: { prepare: (sql: string) => unknown };
	r2: {
		get: (key: string) => Promise<{ body: ReadableStream<Uint8Array>; arrayBuffer: () => Promise<ArrayBuffer> } | null>;
		put: (key: string, data: ReadableStream<Uint8Array> | Uint8Array) => Promise<void>;
		delete: (key: string) => Promise<void>;
		head: (key: string) => Promise<{ key: string } | null>;
	};
};

const toCorpusBackend = (env: Bindings): CorpusBackend => ({
	d1: env.DB as unknown as CorpusBackend["d1"],
	r2: env.MEDIA_CORPUS_BUCKET as unknown as CorpusBackend["r2"],
});

export const createContextFromBindings = (env: Bindings, providerFactory: ProviderFactory): AppContext => ({
	db: drizzle(env.DB, { schema }),
	backend: create_cloudflare_backend(toCorpusBackend(env)),
	providerFactory,
	encryptionKey: env.ENCRYPTION_KEY,
	env: {
		REDDIT_CLIENT_ID: env.REDDIT_CLIENT_ID,
		REDDIT_CLIENT_SECRET: env.REDDIT_CLIENT_SECRET,
		TWITTER_CLIENT_ID: env.TWITTER_CLIENT_ID,
		TWITTER_CLIENT_SECRET: env.TWITTER_CLIENT_SECRET,
		GITHUB_CLIENT_ID: env.GITHUB_CLIENT_ID,
		GITHUB_CLIENT_SECRET: env.GITHUB_CLIENT_SECRET,
	},
});
