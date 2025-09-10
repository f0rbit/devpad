import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { log } from "@devpad/core";
import { authMiddleware } from "./middleware/auth";

// Import route modules
import authRoutes from "./routes/auth";
import v0Routes from "./routes/v0";

export interface ServerOptions {
	/** Enable database migrations on startup */
	runMigrations?: boolean;
	/** Migration folder paths to try (in order) */
	migrationPaths?: string[];
	/** Enable static file serving */
	enableStatic?: boolean;
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

/**
 * Initialize database and run migrations
 */
export async function migrateDb(options: DatabaseOptions): Promise<void> {
	log.startup("🌳 Database file:", options.databaseFile);

	const sqlite = new Database(options.databaseFile);
	const db = drizzle(sqlite);

	log.startup("⌛️ Running migrations...");

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
			log.startup(`⚠️ Migration path ${path} not found, trying next...`);
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

	// Global middleware
	app.use("*", logger());

	// CORS configuration
	const defaultOrigins = ["http://localhost:4321", "http://localhost:3000", "https://devpad.tools"];

	const allowedOrigins = options.corsOrigins || process.env.CORS_ORIGINS?.split(",") || defaultOrigins;

	app.use(
		"*",
		cors({
			origin: process.env.NODE_ENV === "test" ? origin => origin || "*" : allowedOrigins,
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

	// Static file serving (optional)
	if (options.enableStatic && options.staticPath) {
		log.startup(`📁 Serving static files from: ${options.staticPath}`);

		app.use(
			"/*",
			serveStatic({
				root: options.staticPath,
				rewriteRequestPath: path => {
					return path.replace(/^\//, "");
				},
			})
		);

		// SPA fallback - serve index.html for non-API routes
		app.use("/*", async c => {
			if (!c.req.path.startsWith("/api/")) {
				try {
					const indexFile = Bun.file(`${options.staticPath}/index.html`);
					if (await indexFile.exists()) {
						return c.html(await indexFile.text());
					}
				} catch (error) {
					console.error("Error serving index.html:", error);
				}
			}
			return c.text("Not Found", 404);
		});
	} else {
		// API-only mode fallback
		app.use("/*", async c => {
			if (c.req.path.startsWith("/api/")) {
				return c.text("API endpoint not found", 404);
			}
			return c.text("Static content should be served by CDN", 404);
		});
	}

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

	if (options.enableStatic) {
		log.startup(`📁 Static files: ${options.staticPath}`);
	} else {
		log.startup(`🔧 API-only mode (static files served elsewhere)`);
	}

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
