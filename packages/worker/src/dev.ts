import { Database } from "bun:sqlite";
import { createContext as createBlogContext } from "@devpad/core/services/blog";
import { createMediaContext, defaultProviderFactory } from "@devpad/core/services/media";
import type { Bindings } from "@devpad/schema/bindings";
import { create_memory_backend } from "@devpad/schema/blog";
import { createBunDatabase, migrateBunDatabase } from "@devpad/schema/database/bun";
import * as mediaSchema from "@devpad/schema/database/media";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { createApi } from "./index.js";

export type BunServerOptions = {
	database_file: string;
	port?: number;
	migration_paths?: string[];
};

const DEFAULT_MIGRATION_PATHS = ["./packages/schema/src/database/drizzle", "./packages/schema/dist/database/drizzle", "../schema/src/database/drizzle", "../schema/dist/database/drizzle"];

const fake_execution_context = {
	waitUntil: () => {},
	passThroughOnException: () => {},
};

function createFakeBindings(): Bindings {
	return {
		DB: {} as any,
		BLOG_CORPUS_BUCKET: {} as any,
		MEDIA_CORPUS_BUCKET: {} as any,
		ENVIRONMENT: process.env.ENVIRONMENT ?? "development",
		API_URL: process.env.API_URL ?? "http://localhost:3001",
		FRONTEND_URL: process.env.FRONTEND_URL ?? "http://localhost:4321",
		GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID ?? "",
		GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET ?? "",
		JWT_SECRET: process.env.JWT_SECRET ?? "dev-jwt-secret",
		ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ?? "dev-encryption-key",
		REDDIT_CLIENT_ID: process.env.REDDIT_CLIENT_ID ?? "",
		REDDIT_CLIENT_SECRET: process.env.REDDIT_CLIENT_SECRET ?? "",
		TWITTER_CLIENT_ID: process.env.TWITTER_CLIENT_ID ?? "",
		TWITTER_CLIENT_SECRET: process.env.TWITTER_CLIENT_SECRET ?? "",
	};
}

export function migrateBunDb(options: { database_file: string; migration_paths?: string[] }): void {
	const sqlite = new Database(options.database_file);
	const paths = options.migration_paths ?? DEFAULT_MIGRATION_PATHS;

	for (const p of paths) {
		try {
			migrateBunDatabase(sqlite, p);
			sqlite.close();
			return;
		} catch {
			// try next path
		}
	}

	sqlite.close();
	throw new Error("Migrations failed - no valid migration path found");
}

export function createBunApp(options: BunServerOptions) {
	const sqlite = new Database(options.database_file);
	const db = createBunDatabase(sqlite);
	const fake_bindings = createFakeBindings();

	const blog_context = createBlogContext({
		db: drizzle(sqlite) as any,
		backend: create_memory_backend(),
		jwt_secret: fake_bindings.JWT_SECRET,
		environment: fake_bindings.ENVIRONMENT,
	});

	const media_context = createMediaContext({
		db: drizzle(sqlite, { schema: mediaSchema }) as any,
		backend: create_memory_backend(),
		providerFactory: defaultProviderFactory,
		encryptionKey: fake_bindings.ENCRYPTION_KEY,
	});

	const app = createApi({ db, contexts: false, blogContext: blog_context, mediaContext: media_context });

	const fetch = (request: Request) => app.fetch(request, fake_bindings, fake_execution_context as any);

	return { app, fetch, db };
}

export function startBunServer(options: BunServerOptions): void {
	migrateBunDb(options);
	const { fetch } = createBunApp(options);
	const port = options.port ?? 3001;
	Bun.serve({ port, fetch });
}
