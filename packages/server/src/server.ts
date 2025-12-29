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
import fs from "fs";

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

const DEFAULT_ORIGINS = ["http://localhost:4321", "http://localhost:3000", "https://devpad.tools", "https://staging.devpad.tools", "https://media.devpad.tools"];

/**
 * Initialize database and run migrations
 */
export async function migrateDb(options: DatabaseOptions): Promise<void> {
	// Debug logging
	console.log("🔍 Debug - Current working directory:", process.cwd());
	console.log("🔍 Debug - DATABASE_FILE env:", process.env.DATABASE_FILE);
	console.log("🔍 Debug - Using database file:", options.databaseFile);

	// List files in current directory
	try {
		console.log("🔍 Debug - Files in /app:");
		const appFiles = fs.readdirSync("/app");
		appFiles.forEach(f => console.log("  -", f));

		if (fs.existsSync("/app/packages")) {
			console.log("🔍 Debug - Files in /app/packages:");
			const pkgFiles = fs.readdirSync("/app/packages");
			pkgFiles.forEach(f => console.log("  -", f));

			if (fs.existsSync("/app/packages/schema")) {
				console.log("🔍 Debug - Files in /app/packages/schema:");
				const schemaFiles = fs.readdirSync("/app/packages/schema");
				schemaFiles.forEach(f => console.log("  -", f));

				if (fs.existsSync("/app/packages/schema/dist")) {
					console.log("🔍 Debug - Files in /app/packages/schema/dist:");
					const distFiles = fs.readdirSync("/app/packages/schema/dist");
					distFiles.forEach(f => console.log("  -", f));
				}

				if (fs.existsSync("/app/packages/schema/src")) {
					console.log("🔍 Debug - Files in /app/packages/schema/src:");
					const srcFiles = fs.readdirSync("/app/packages/schema/src");
					srcFiles.forEach(f => console.log("  -", f));

					if (fs.existsSync("/app/packages/schema/src/database")) {
						console.log("🔍 Debug - Files in /app/packages/schema/src/database:");
						const dbFiles = fs.readdirSync("/app/packages/schema/src/database");
						dbFiles.forEach(f => console.log("  -", f));
					}
				}
			}
		}
	} catch (e) {
		console.log("🔍 Debug - Error listing files:", e);
	}

	log.startup("🌳 Database file:", options.databaseFile);

	const sqlite = new Database(options.databaseFile);
	const db = drizzle(sqlite);

	log.startup("⌛ Running migrations...");

	const defaultPaths = [
		"./packages/schema/dist/database/drizzle", // Docker built location
		"./packages/schema/src/database/drizzle", // Docker source location
		"../schema/dist/database/drizzle", // Relative built
		"../schema/src/database/drizzle", // Relative source
		"../../schema/src/database/drizzle", // Development
		"./src/database/drizzle", // Fallback
	];

	const migrationPaths = options.migrationPaths || defaultPaths;
	console.log("🔍 Debug - Will check migration paths:", migrationPaths);

	let migrationsRun = false;
	for (const path of migrationPaths) {
		try {
			console.log(`🔍 Debug - Checking migration path: ${path}`);
			migrate(db, { migrationsFolder: path });
			log.startup(`✅ Migrations complete from ${path}`);
			migrationsRun = true;
			break;
		} catch (error: any) {
			console.log(`🔍 Debug - Migration path ${path} failed:`, error.message);
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

	// Logger middleware - skip health checks and assets to reduce noise
	app.use("*", async (c, next) => {
		// Skip logging for health check endpoints and static assets to reduce noise
		if (c.req.path === "/health" || c.req.path.startsWith("/_astro")) {
			return next();
		}
		// Apply logger middleware for all other routes
		return logger()(c, next);
	});

	const ALLOWED_ORIGINS = options.corsOrigins || process.env.CORS_ORIGINS?.split(",") || DEFAULT_ORIGINS;

	app.use(
		"*",
		cors({
			origin: process.env.NODE_ENV === "test" ? origin => origin || "*" : ALLOWED_ORIGINS,
			credentials: true,
			allowHeaders: ["Authorization", "Content-Type"],
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
	app.use("/*", serveStatic({ root: options.staticPath }));

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
