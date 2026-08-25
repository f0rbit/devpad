import { createSessionCookie, getSessionCookieName, validateSession } from "@devpad/core/auth";
import { graph, hooks } from "@devpad/core/services";
import {
	type ActionExecutor,
	CFQueueProvider,
	compose_executors,
	type DispatchProvider,
	InMemoryDispatcher,
	PipelineActionExecutor,
	process_task_event,
	VaultActionExecutor,
	WebhookActionExecutor,
} from "@devpad/core/services/hooks";
import type { AppContext as BlogAppContext } from "@devpad/core/services/blog";
import type { AppContext as MediaAppContext } from "@devpad/core/services/media";
import { createMediaContext, createProviderFactory, handleCron } from "@devpad/core/services/media";
import type { Bindings } from "@devpad/schema/bindings";
import { createD1Database } from "@devpad/schema/database/d1";
import type { Database } from "@devpad/schema/database/types";
import { create_cloudflare_backend } from "@f0rbit/corpus/cloudflare";
import { createPulse } from "@f0rbit/pulse-client";
import { pulseTracing } from "@f0rbit/pulse-client/hono";
import { make_log, noop_log } from "./lib/log.js";
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
	/**
	 * v2.4 (task A3.3) — injected the same way `db`/`config` are for the bun
	 * dev/test path (`dev.ts`), which never has real `c.env` bindings.
	 * Undefined in the real Workers runtime, where `c.env.HOOKS_QUEUE` is
	 * always resolvable instead.
	 */
	dispatch?: DispatchProvider;
};

type AstroHandler = {
	fetch: (request: Request, env: Record<string, unknown>, ctx: ExecutionContext) => Promise<Response>;
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
			origin: (origin) => {
				if (!origin) return origin;
				const allowed = [
					"http://localhost:4321",
					"http://localhost:3000",
					"http://localhost:3001",
					"http://localhost:3002",
					"http://localhost:3003",
				];
				if (allowed.includes(origin)) return origin;
				if (origin.endsWith(".devpad.tools") || origin === "https://devpad.tools") return origin;
				if (origin.endsWith(".workers.dev") || origin.endsWith(".pages.dev")) return origin;
				return null;
			},
			allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
			allowHeaders: ["Content-Type", "Authorization", "Auth-Token"],
			credentials: true,
		}),
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

	if (options?.config && options.oauth_secrets) {
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

	// Pulse instrumentation. Created per request because Workers isolates are
	// short-lived; we extend with waitUntil so the debounced flush completes
	// before the worker terminates (otherwise queued events are lost).
	app.use("*", async (c, next) => {
		const config = c.get("config");
		if (!config.pulse_api_base || !config.pulse_devpad_ingest_key || !config.devpad_project_id) {
			c.set("log", noop_log);
			await next();
			return;
		}
		const pulse = createPulse({
			project_id: config.devpad_project_id,
			ingest_key: config.pulse_devpad_ingest_key,
			endpoint: config.pulse_api_base,
			release: config.git_sha,
		});
		c.set("pulse", pulse);
		c.set("log", make_log(pulse));
		await pulseTracing({ pulse })(c, next);
		try {
			c.executionCtx.waitUntil(pulse.flush());
		} catch {
			// executionCtx unavailable in some local/test contexts — skip waitUntil.
		}
	});

	// Capture uncaught errors from route handlers via pulse + structured response.
	app.onError((err, c) => {
		const pulse = c.get("pulse");
		if (pulse) {
			pulse.captureError(err, {
				method: c.req.method,
				path: c.req.path,
			});
			try {
				c.executionCtx.waitUntil(pulse.flush());
			} catch {
				// no-op
			}
		}
		c.get("log")?.error("unhandled error", err);
		return c.json({ error: "Internal server error" }, 500);
	});

	// v2.4 (task A3.3/A3.4) — resolve the dispatch provider BEFORE the route
	// runs (so `/tasks/:id/done` etc. can force an immediate attempt via
	// `c.get("dispatch")`), then drain every pending outbox row after.
	// `options.dispatch` is only ever set by the bun dev/test path
	// (`dev.ts`), which has no real `c.env` bindings — mirrors how
	// `db`/`config` are injected there. The real Workers runtime always
	// falls through to `c.env.HOOKS_QUEUE`.
	app.use("*", async (c, next) => {
		// Liveness check must stay independent of the DB — no outbox drain here.
		if (c.req.path === "/health") return next();

		const db = c.get("db");
		const dispatch =
			options?.dispatch ??
			(c.env.HOOKS_QUEUE
				? new CFQueueProvider(c.env.HOOKS_QUEUE)
				: new InMemoryDispatcher(async (message) => {
						const executor = buildHookExecutor(c.env, db);
						const result = await process_task_event(db, { pulse: c.get("pulse"), executor }, message.event_id);
						if (!result.ok) console.error("[worker] hook dispatch failed:", result.error);
					}));
		c.set("dispatch", dispatch);

		await next();

		const drain_task = hooks.drain_pending_events(db, dispatch);
		try {
			c.executionCtx.waitUntil(drain_task);
		} catch {
			await drain_task;
		}
	});

	app.use("*", authMiddleware);
	if (options?.blogContext && options.mediaContext) {
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

	app.get("/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

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
	if (!result.ok) {
		return { request };
	}

	const headers = new Headers(request.headers);
	headers.set(
		"X-Auth-User",
		JSON.stringify({
			id: result.value.user.id,
			github_id: result.value.user.github_id,
			name: result.value.user.name,
			task_view: result.value.user.task_view,
		}),
	);
	headers.set("X-Auth-Session-Id", result.value.session.id);

	const authed = new Request(request, { headers });
	const session_cookie = result.value.session.fresh
		? createSessionCookie(result.value.session.id, cookieConfig(env.ENVIRONMENT))
		: undefined;

	return { request: authed, session_cookie };
}

/**
 * v2.4 (task A3.4) — composes the real webhook/pipeline/vault executors
 * straight from Cloudflare bindings — usable both from the real Workers
 * runtime (`c.env`) and the `queue()` handler's own `env` param, which is
 * why this reads `Bindings` rather than the per-request `AppConfig` (bun
 * dev/tests never reach this function at all; they use `dev.ts`'s injected
 * `ApiOptions.dispatch` instead, see `createApi()`). `pipeline`/`vault` are
 * omitted (permanent-failure, not silently no-op) when their config/binding
 * isn't present — see each executor's own module doc for why that's the
 * right failure mode.
 */
function buildHookExecutor(env: Bindings, db: Database): ActionExecutor {
	const webhook = WebhookActionExecutor({ encryption_key: env.ENCRYPTION_KEY });
	const pipeline =
		env.PIPELINES_API_BASE && env.PIPELINES_TOKEN
			? PipelineActionExecutor({ orchestrator_base: env.PIPELINES_API_BASE, token: env.PIPELINES_TOKEN, db })
			: undefined;
	const vault = env.VAULT_GITHUB
		? VaultActionExecutor({ vault_github: env.VAULT_GITHUB, environment: env.ENVIRONMENT })
		: undefined;
	return compose_executors({ webhook, pipeline, vault });
}

function buildPulseForEnv(env: Bindings): ReturnType<typeof createPulse> | undefined {
	if (!env.PULSE_API_BASE || !env.PULSE_DEVPAD_INGEST_KEY || !env.DEVPAD_PROJECT_ID) return undefined;
	return createPulse({
		project_id: env.DEVPAD_PROJECT_ID,
		ingest_key: env.PULSE_DEVPAD_INGEST_KEY,
		endpoint: env.PULSE_API_BASE,
		release: env.GIT_SHA,
	});
}

/** v2.4 (task A3.3) — cron backstop re-enqueueing task_event rows a crashed waitUntil never drained. */
async function runHookStaleSweep(db: Database, env: Bindings): Promise<void> {
	if (!env.HOOKS_QUEUE) return;
	const result = await hooks.drain_stale_events(db, new CFQueueProvider(env.HOOKS_QUEUE));
	if (!result.ok) {
		console.error("[worker] hook stale-event sweep failed:", result.error);
		return;
	}
	if (result.value > 0) console.log(`[worker] re-enqueued ${String(result.value)} stale task_event row(s)`);
}

/** v2.4 (task A3.7) — retention sweep. `failed_permanent` hook_delivery rows are never touched (the visible DLQ). */
async function runHookRetentionSweep(db: Database): Promise<void> {
	const result = await hooks.sweep_retention(db);
	if (!result.ok) {
		console.error("[worker] hook retention sweep failed:", result.error);
		return;
	}
	const report = result.value;
	if (report.task_events_pruned > 0 || report.hook_deliveries_pruned > 0 || report.github_webhook_events_pruned > 0) {
		console.log("[worker] hook retention sweep pruned:", report);
	}
}

/** v2.4 graph sweep (task A2.4) — crash repair + invariant verification, on the existing 5-min cron. */
async function runGraphSweep(db: Database): Promise<void> {
	const result = await graph.sweep_graph(db);
	if (!result.ok) {
		console.error("[worker] graph sweep failed:", result.error);
		return;
	}
	const report = result.value;
	if (
		report.cascades_repaired > 0 ||
		report.rollups_repaired > 0 ||
		report.siblings_rebalanced > 0 ||
		report.cycle_violations > 0 ||
		report.depth_violations > 0
	) {
		console.log("[worker] graph sweep repaired/flagged:", report);
	}
}

export function createUnifiedWorker(handlers: UnifiedHandlers) {
	const api = createApi();

	return {
		async fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
			const hostname = hostnameFor(request);
			const path = new URL(request.url).pathname;

			const enriched_env = { ...env, internal_api: api };

			if (isApiRequest(path)) {
				return api.fetch(request, enriched_env, ctx);
			}

			const auth = await resolveAuth(request, env);

			const handler = hostname.startsWith("blog.")
				? handlers.blog
				: hostname.startsWith("media.")
					? handlers.media
					: handlers.devpad;

			let response: Response;
			try {
				response = await handler.fetch(auth.request, enriched_env, ctx);
			} catch (err) {
				console.error(`[worker] Astro handler threw for ${hostname}${path}:`, err);
				response = new Response("Not Found", { status: 404 });
			}

			if (auth.session_cookie) {
				const refreshed = new Response(response.body, response);
				refreshed.headers.append("Set-Cookie", auth.session_cookie);
				return refreshed;
			}

			return response;
		},

		async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext): Promise<void> {
			if (!env.DB) {
				return;
			}
			const db = createD1Database(env.DB);
			ctx.waitUntil(runGraphSweep(db));
			ctx.waitUntil(runHookStaleSweep(db, env));
			ctx.waitUntil(runHookRetentionSweep(db));

			if (!env.MEDIA_CORPUS_BUCKET) {
				return;
			}
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

		/** v2.4 (task A3.3/A3.4) — `devpad-hooks`/`devpad-hooks-preview` consumer, real webhook/pipeline/vault executors. */
		async queue(batch: MessageBatch<{ event_id: string }>, env: Bindings, ctx: ExecutionContext): Promise<void> {
			if (!env.DB) return;
			const db = createD1Database(env.DB);
			const pulse = buildPulseForEnv(env);
			const executor = buildHookExecutor(env, db);

			for (const message of batch.messages) {
				const result = await process_task_event(db, { pulse, executor }, message.body.event_id);
				if (!result.ok) {
					console.error("[worker] hook dispatch failed:", result.error);
					message.retry();
					continue;
				}
				if (result.value === "retry") {
					message.retry();
				} else {
					message.ack();
				}
			}

			if (pulse) ctx.waitUntil(pulse.flush());
		},
	};
}

export type { AstroHandler, UnifiedHandlers };
