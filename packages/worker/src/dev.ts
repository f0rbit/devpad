import { Database } from "bun:sqlite";
import { createContext as createBlogContext } from "@devpad/core/services/blog";
import { createMediaContext, defaultProviderFactory } from "@devpad/core/services/media";
import { create_memory_backend } from "@devpad/schema/blog";
import { createBunDatabase, migrateBunDatabase } from "@devpad/schema/database/bun";
import * as mediaSchema from "@devpad/schema/database/media";
import { drizzle } from "drizzle-orm/bun-sqlite";
import type { AppConfig, OAuthSecrets } from "./bindings.js";
import { createApi } from "./index.js";

export type BunServerOptions = {
	database_file: string;
	port?: number;
	migration_paths?: string[];
};

const DEFAULT_MIGRATION_PATHS = ["./packages/schema/src/database/drizzle", "./packages/schema/dist/database/drizzle", "../schema/src/database/drizzle", "../schema/dist/database/drizzle"];

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

	const config: AppConfig = {
		environment: process.env.ENVIRONMENT ?? "development",
		api_url: process.env.API_URL ?? "http://localhost:3001",
		frontend_url: process.env.FRONTEND_URL ?? "http://localhost:4321",
		jwt_secret: process.env.JWT_SECRET ?? "dev-jwt-secret",
		encryption_key: process.env.ENCRYPTION_KEY ?? "dev-encryption-key",
	};

	const oauth_secrets: OAuthSecrets = {
		github_client_id: process.env.GITHUB_CLIENT_ID ?? "",
		github_client_secret: process.env.GITHUB_CLIENT_SECRET ?? "",
		reddit_client_id: process.env.REDDIT_CLIENT_ID ?? "",
		reddit_client_secret: process.env.REDDIT_CLIENT_SECRET ?? "",
		twitter_client_id: process.env.TWITTER_CLIENT_ID ?? "",
		twitter_client_secret: process.env.TWITTER_CLIENT_SECRET ?? "",
	};

	const blog_context = createBlogContext({
		db: drizzle(sqlite) as any,
		backend: create_memory_backend(),
		jwt_secret: config.jwt_secret,
		environment: config.environment,
	});

	const media_context = createMediaContext({
		db: drizzle(sqlite, { schema: mediaSchema }) as any,
		backend: create_memory_backend(),
		providerFactory: defaultProviderFactory,
		encryptionKey: config.encryption_key,
	});

	const app = createApi({
		db,
		blogContext: blog_context,
		mediaContext: media_context,
		config,
		oauth_secrets,
	});

	const fetch = (request: Request) => app.fetch(request);

	return { app, fetch, db };
}

export function startBunServer(options: BunServerOptions): void {
	migrateBunDb(options);
	const { fetch } = createBunApp(options);
	const port = options.port ?? 3001;
	Bun.serve({ port, fetch });
}
