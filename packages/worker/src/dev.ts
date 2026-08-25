import { Database } from "bun:sqlite";
import { createContext as createBlogContext } from "@devpad/core/services/blog";
import { InMemoryDispatcher, NoopActionExecutor, process_task_event } from "@devpad/core/services/hooks";
import { createMediaContext, defaultProviderFactory } from "@devpad/core/services/media";
import { create_memory_backend } from "@devpad/schema/blog";
import { createBunDatabase, migrateBunDatabase } from "@devpad/schema/database/bun";
import type { AppConfig, OAuthSecrets } from "./bindings.js";
import { createApi } from "./index.js";

export type BunServerOptions = {
	database_file: string;
	port?: number;
	migration_paths?: string[];
};

const DEFAULT_MIGRATION_PATHS = [
	"./packages/schema/src/database/drizzle",
	"./packages/schema/dist/database/drizzle",
	"../schema/src/database/drizzle",
	"../schema/dist/database/drizzle",
];

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
		pipelines_api_base: process.env.PIPELINES_API_BASE,
		pipelines_token: process.env.PIPELINES_TOKEN,
		// Stable dev-only fallback (same pattern as jwt_secret/encryption_key
		// above) rather than leaving it unset — deterministic regardless of
		// which integration test file happens to trigger the shared server's
		// one-time startup first.
		github_webhook_secret: process.env.GITHUB_WEBHOOK_SECRET ?? "dev-github-webhook-secret",
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
		db,
		backend: create_memory_backend(),
		jwt_secret: config.jwt_secret,
		environment: config.environment,
	});

	const media_context = createMediaContext({
		db,
		backend: create_memory_backend(),
		providerFactory: defaultProviderFactory,
		encryptionKey: config.encryption_key,
	});

	// v2.4 (task A3.3) — no real Cloudflare Queue in the bun runtime; the
	// consumer runs synchronously so integration tests observe hook
	// deliveries deterministically without polling for a real queue.
	const dispatch = new InMemoryDispatcher(async (message) => {
		const result = await process_task_event(db, { executor: NoopActionExecutor }, message.event_id);
		if (!result.ok) console.error("[dev] hook dispatch failed:", result.error);
	});

	const app = createApi({
		db,
		blogContext: blog_context,
		mediaContext: media_context,
		config,
		oauth_secrets,
		dispatch,
		// v2.4 (task A4.1) — no real R2/D1 corpus bucket in the bun runtime;
		// same pattern as blog/media's memory-backed contexts above.
		docsBackend: create_memory_backend(),
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
