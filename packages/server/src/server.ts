import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { log } from "@devpad/core";
import { authMiddleware } from "./middleware/auth";
import { handler as ssrHandler } from "../../app/dist/server/entry.mjs";

// Import route modules
import authRoutes from "./routes/auth";
import v0Routes from "./routes/v0";

export interface ServerOptions {
	/** Enable database migrations on startup */
	runMigrations?: boolean;
	/** Migration folder paths to try (in order) */
	migrationPaths?: string[];
	/** Path to static files */
	staticPath?: string;
	/** CORS allowed origins */
	corsOrigins?: string[];
	/** Server port */
	port?: number;
	/** Environment name for logging */
	environment?: string;
}

export interface DatabaseOptions {
	/** Database file path */
	databaseFile: string;
	/** Migration folder paths to try (in order) */
	migrationPaths?: string[];
}

const DEFAULT_ORIGINS = ["http://localhost:4321", "http://localhost:3000", "https://devpad.tools", "https://staging.devpad.tools"];

/**
 * Initialize database and run migrations
 */
export async function migrateDb(options: DatabaseOptions): Promise<void> {
	log.startup("🌳 Database file:", options.databaseFile);

	const sqlite = new Database(options.databaseFile);
	const db = drizzle(sqlite);

	log.startup("⌛ Running migrations...");

	const defaultPaths = ["./packages/schema/src/database/drizzle", "../schema/src/database/drizzle", "../../schema/src/database/drizzle", "./src/database/drizzle"];

	const migrationPaths = options.migrationPaths || defaultPaths;

	let migrationsRun = false;
	for (const path of migrationPaths) {
		try {
			migrate(db, { migrationsFolder: path });
			log.startup(`✅ Migrations complete from ${path}`);
			migrationsRun = true;
			break;
		} catch (error) {
			log.startup(`! Migration path ${path} not found, trying next...`);
		}
	}

	if (!migrationsRun) {
		console.error("❌ Could not find migration files in any expected location");
		throw new Error("Database migrations failed");
	}
}

/**
 * Create and configure the Hono application
 */
export function createApp(options: ServerOptions = {}): Hono {
	const app = new Hono();

	app.use("*", logger());

	const ALLOWED_ORIGINS = options.corsOrigins || process.env.CORS_ORIGINS?.split(",") || DEFAULT_ORIGINS;

	app.use(
		"*",
		cors({
			origin: process.env.NODE_ENV === "test" ? origin => origin || "*" : ALLOWED_ORIGINS,
			credentials: true,
		})
	);

	// Health check (before auth middleware)
	app.get("/health", c =>
		c.json({
			status: "ok",
			timestamp: new Date().toISOString(),
			version: process.env.npm_package_version || "unknown",
			environment: options.environment || process.env.NODE_ENV || "development",
		})
	);

	// Apply auth middleware to auth routes (except login/callback which need to be public)
	app.use("/api/auth/verify", authMiddleware);
	app.use("/api/auth/session", authMiddleware);

	// Apply auth middleware to other API routes
	app.use("/api/v0/*", authMiddleware);

	// Auth routes (login/callback public, verify/session protected by middleware above)
	app.route("/api/auth", authRoutes);

	// API Routes
	app.route("/api/v0", v0Routes);

	// Serve static files first - this needs to come before SSR handler
	// When running from packages/server directory, the path is ../app/dist/client/
	app.use("/*", serveStatic({ root: "../app/dist/client/" }));

	// Use the SSR handler for everything that's not a static file or API
	// The handler is a Hono middleware that expects (ctx, next, locals)
	app.use(ssrHandler);

	// Final 404 handler for any unmatched routes (shouldn't be reached if SSR handles 404s)
	app.notFound(c => {
		if (c.req.path.startsWith("/api/")) {
			return c.text("API endpoint not found", 404);
		}
		// The SSR handler should handle 404 pages, but just in case
		return c.text("Page not found", 404);
	});

	return app;
}

/**
 * Start the server with the given options
 */
export async function startServer(options: ServerOptions = {}): Promise<void> {
	const { runMigrations = false, port = Number(process.env.PORT) || 3000, environment = process.env.NODE_ENV || "development" } = options;

	// Run migrations if requested
	if (runMigrations) {
		const databaseFile = process.env.DATABASE_FILE;
		if (!databaseFile) {
			throw new Error("DATABASE_FILE environment variable is required for migrations");
		}

		await migrateDb({
			databaseFile,
			migrationPaths: options.migrationPaths,
		});
	}

	// Create and configure the app
	const app = createApp(options);

	// Log startup information
	log.startup(`🚀 ${environment} server starting on port ${port}`);

	log.startup(`🎯 API routes: /api/*`);
	log.startup(`🌐 CORS origins: ${options.corsOrigins?.join(", ") || "default"}`);

	// Start the server
	const server = Bun.serve({
		port,
		fetch: app.fetch,
	});

	log.startup(`✅ Server running at http://localhost:${server.port}`);
}

/**
 * Export the server for external use (e.g., serverless)
 */
export function createServerExport(options: ServerOptions = {}) {
	const app = createApp(options);
	const port = options.port || Number(process.env.PORT) || 3000;

	return {
		port,
		fetch: app.fetch,
	};
}
