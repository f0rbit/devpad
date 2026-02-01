import type { AppContext as BlogAppContext } from "@devpad/core/services/blog";
import type { AppContext as MediaAppContext } from "@devpad/core/services/media";
import { createMediaContext, createProviderFactory, handleCron } from "@devpad/core/services/media";
import type { Bindings } from "@devpad/schema/bindings";
import { createD1Database } from "@devpad/schema/database/d1";
import type { Database } from "@devpad/schema/database/types";
import { create_cloudflare_backend } from "@f0rbit/corpus/cloudflare";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AppConfig, AppContext, OAuthSecrets } from "./bindings.js";
import { authMiddleware } from "./middleware/auth.js";
import { configMiddleware } from "./middleware/config.js";
import { unifiedContextMiddleware } from "./middleware/context.js";
import { dbMiddleware } from "./middleware/db.js";
import { requestContextMiddleware } from "./middleware/request-context.js";
import authRoutes from "./routes/auth.js";
import blogRoutes from "./routes/v1/blog/index.js";
import v1Routes from "./routes/v1/index.js";
import { authRoutes as mediaAuthRoutes } from "./routes/v1/media/auth.js";
import mediaRoutes from "./routes/v1/media/index.js";

export type ApiOptions = {
	db?: Database;
	blogContext?: BlogAppContext;
	mediaContext?: MediaAppContext;
	config?: AppConfig;
	oauth_secrets?: OAuthSecrets;
};

type AstroHandler = {
	fetch: (request: Request, env: any, ctx: ExecutionContext) => Promise<Response>;
};

type ApiHandler = {
	fetch: (request: Request) => Promise<Response>;
};

type UnifiedHandlers = {
	devpad: AstroHandler;
	blog: AstroHandler;
	media: AstroHandler;
};

const isApiRequest = (path: string) => path.startsWith("/api/") || path === "/health";

export const createApi = (options?: ApiOptions) => {
	const app = new Hono<AppContext>();

	app.use("*", requestContextMiddleware());

	app.use(
		"/api/*",
		cors({
			origin: origin => {
				const allowed = ["http://localhost:4321", "http://localhost:3000", "https://media.devpad.tools", "https://devpad.tools", "https://blog.devpad.tools"];
				if (!origin || allowed.includes(origin)) return origin;
				if (origin.endsWith(".workers.dev") || origin.endsWith(".pages.dev")) return origin;
				return null;
			},
			allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
			allowHeaders: ["Content-Type", "Authorization", "Auth-Token"],
			credentials: true,
		})
	);

	if (options?.db) {
		const injected_db = options.db;
		app.use("*", async (c, next) => {
			c.set("db", injected_db);
			await next();
		});
	} else {
		app.use("*", dbMiddleware);
	}

	if (options?.config && options?.oauth_secrets) {
		const injected_config = options.config;
		const injected_secrets = options.oauth_secrets;
		app.use("*", async (c, next) => {
			c.set("config", injected_config);
			c.set("oauth_secrets", injected_secrets);
			await next();
		});
	} else {
		app.use("*", configMiddleware);
	}

	app.use("*", authMiddleware);
	if (options?.blogContext && options?.mediaContext) {
		const blog_ctx = options.blogContext;
		const media_ctx = options.mediaContext;
		app.use("*", async (c, next) => {
			c.set("blogContext", blog_ctx);
			c.set("mediaContext", media_ctx);
			await next();
		});
	} else {
		app.use("*", unifiedContextMiddleware);
	}

	app.get("/health", c => c.json({ status: "ok", timestamp: new Date().toISOString() }));

	app.route("/api/auth", authRoutes);
	app.route("/api/auth/platforms", mediaAuthRoutes);

	app.route("/api/v1", v1Routes);
	app.route("/api/v1/blog", blogRoutes);
	app.route("/api/v1", mediaRoutes);

	return app;
};

const hostnameFor = (request: Request) => {
	const host = request.headers.get("host") || new URL(request.url).host;
	return host.toLowerCase();
};

export function createUnifiedWorker(handlers: UnifiedHandlers) {
	const api = createApi();

	return {
		async fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
			const hostname = hostnameFor(request);
			const path = new URL(request.url).pathname;

			if (isApiRequest(path)) {
				return api.fetch(request, env, ctx);
			}

			const apiHandler: ApiHandler = { fetch: (req: Request) => api.fetch(req, env, ctx) };

			if (hostname.includes("blog.devpad.tools")) {
				return handlers.blog.fetch(request, { ...env, API_HANDLER: apiHandler }, ctx);
			}

			if (hostname.includes("media.devpad.tools")) {
				return handlers.media.fetch(request, { ...env, API_HANDLER: apiHandler }, ctx);
			}

			return handlers.devpad.fetch(request, { ...env, API_HANDLER: apiHandler }, ctx);
		},

		async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext): Promise<void> {
			if (!env.DB || !env.MEDIA_CORPUS_BUCKET) {
				return;
			}
			const db = createD1Database(env.DB);
			const media_backend = create_cloudflare_backend({ d1: env.DB, r2: env.MEDIA_CORPUS_BUCKET });
			const app_ctx = createMediaContext({
				db,
				backend: media_backend,
				providerFactory: createProviderFactory(db),
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
			ctx.waitUntil(handleCron(app_ctx));
		},
	};
}

export type { AstroHandler, ApiHandler, UnifiedHandlers };
