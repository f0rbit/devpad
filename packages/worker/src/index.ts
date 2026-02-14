import { createSessionCookie, getSessionCookieName, validateSession } from "@devpad/core/auth";
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
import { cookieConfig } from "./utils/cookies.js";

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
				if (!origin) return origin;
				const allowed = ["http://localhost:4321", "http://localhost:3000", "http://localhost:3001", "http://localhost:3002", "http://localhost:3003"];
				if (allowed.includes(origin)) return origin;
				if (origin.endsWith(".devpad.tools") || origin === "https://devpad.tools") return origin;
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

function parseCookie(request: Request, name: string): string | undefined {
	const header = request.headers.get("cookie");
	if (!header) return undefined;
	const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
	return match?.[1];
}

async function resolveAuth(request: Request, env: Bindings): Promise<{ request: Request; session_cookie?: string }> {
	if (!env.DB) return { request };

	const session_id = parseCookie(request, getSessionCookieName());
	if (!session_id) return { request };

	const db = createD1Database(env.DB);
	const result = await validateSession(db, session_id);
	if (!result.ok) return { request };

	const headers = new Headers(request.headers);
	headers.set(
		"X-Auth-User",
		JSON.stringify({
			id: result.value.user.id,
			github_id: result.value.user.github_id,
			name: result.value.user.name,
			task_view: result.value.user.task_view,
		})
	);
	headers.set("X-Auth-Session-Id", result.value.session.id);

	const authed = new Request(request, { headers });
	const session_cookie = result.value.session.fresh ? createSessionCookie(result.value.session.id, cookieConfig(env.ENVIRONMENT ?? "production")) : undefined;

	return { request: authed, session_cookie };
}

export function createUnifiedWorker(handlers: UnifiedHandlers) {
	const api = createApi();

	return {
		async fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
			const hostname = hostnameFor(request);
			const path = new URL(request.url).pathname;

			if (isApiRequest(path)) {
				return api.fetch(request, env, ctx);
			}

			const auth = await resolveAuth(request, env);

			const handler = hostname.startsWith("blog.") ? handlers.blog : hostname.startsWith("media.") ? handlers.media : handlers.devpad;

			const response = await handler.fetch(auth.request, env, ctx);

			if (auth.session_cookie) {
				const refreshed = new Response(response.body, response);
				refreshed.headers.append("Set-Cookie", auth.session_cookie);
				return refreshed;
			}

			return response;
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

export type { AstroHandler, UnifiedHandlers };
