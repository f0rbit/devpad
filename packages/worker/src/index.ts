import { createContextFromBindings, createProviderFactory, handleCron } from "@devpad/core/services/media";
import type { Bindings } from "@devpad/schema/bindings";
import type { UnifiedDatabase } from "@devpad/schema/database/d1";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AppContext } from "./bindings.js";
import { authMiddleware } from "./middleware/auth.js";
import { unifiedContextMiddleware } from "./middleware/context.js";
import { dbMiddleware } from "./middleware/db.js";
import { requestContextMiddleware } from "./middleware/request-context.js";
import authRoutes from "./routes/auth.js";
import blogRoutes from "./routes/v1/blog/index.js";
import v1Routes from "./routes/v1/index.js";
import { authRoutes as mediaAuthRoutes } from "./routes/v1/media/auth.js";
import mediaRoutes from "./routes/v1/media/index.js";

export type ApiOptions = {
	db?: UnifiedDatabase;
	contexts?: boolean;
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
	app.use("*", authMiddleware);
	if (options?.contexts !== false) {
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
			const app_ctx = createContextFromBindings(env, createProviderFactory(env.DB));
			ctx.waitUntil(handleCron(app_ctx));
		},
	};
}

export type { AstroHandler, ApiHandler, UnifiedHandlers };
