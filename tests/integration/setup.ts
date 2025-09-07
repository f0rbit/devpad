/**
 * Integration test setup with global shared server
 * Uses bun's preload feature for single server instance across all tests
 */

import { beforeAll, afterAll } from "bun:test";
import path from "node:path";
import ApiClient from "@devpad/api";
import { TEST_USER_ID, DEBUG_LOGGING, log, setupTestDatabase, createTestUser, cleanupTestDatabase, waitForServer } from "../shared/test-utils";

export const TEST_BASE_URL = "http://localhost:3001/api/v0";
export { TEST_USER_ID, DEBUG_LOGGING };

// Global shared server state
let honoServer: any = null;
let testApiKey: string | null = null;
let testClient: ApiClient | null = null;
let setupPromise: Promise<void> | null = null;
let isSetupComplete = false;

/**
 * Perform the actual setup logic
 */
async function performSetup(): Promise<void> {
	if (isSetupComplete) return;

	log("🌍 Starting integration test setup...");

	// Set environment variables early
	const baseDir = path.resolve(process.cwd());
	const dbPath = path.join(baseDir, "database", "test.db");
	process.env.NODE_ENV = "test";
	process.env.DATABASE_URL = `sqlite://${dbPath}`;
	process.env.DATABASE_FILE = dbPath;

	// Setup test database
	await setupTestDatabase(dbPath);
	log("✅ Test database setup complete");

	// Start Hono server
	await startHonoServer();
	log("✅ Hono server started and ready");

	// Create test user and API key
	testApiKey = await createTestUser(dbPath);
	log("✅ Test user and API key created");

	// Create shared test client
	testClient = new ApiClient({
		base_url: TEST_BASE_URL,
		api_key: testApiKey,
	});

	isSetupComplete = true;
	log("🌍 Integration test setup completed - server ready for all tests");
}

/**
 * Ensure setup is complete (lazy initialization)
 */
async function ensureSetup(): Promise<void> {
	if (setupPromise) return setupPromise;

	setupPromise = performSetup();
	return setupPromise;
}

/**
 * Get the shared API client instance - lazily initializes if needed
 */
export async function getSharedApiClient(): Promise<ApiClient> {
	await ensureSetup();
	return testClient!;
}

/**
 * Legacy function for backward compatibility - now uses lazy initialization
 */
export async function setupIntegrationTests(): Promise<ApiClient> {
	return await getSharedApiClient();
}

/**
 * No-op teardown since server cleanup is handled globally
 */
export async function teardownIntegrationTests(): Promise<void> {
	// No-op - global teardown handles server cleanup
	return;
}

/**
 * Legacy export for compatibility
 */
export { getSharedApiClient as testClient };

/**
 * Perform cleanup of server and database
 */
export async function performCleanup(): Promise<void> {
	if (!isSetupComplete) return; // Nothing to clean up

	log("🌍 Starting integration test cleanup...");

	// Stop Hono server
	if (honoServer) {
		honoServer.stop();
		honoServer = null;
		log("✅ Hono server stopped");
	}

	// Clean up test database
	const dbPath = path.join(process.cwd(), "database", "test.db");
	cleanupTestDatabase(dbPath);
	log("✅ Test database cleaned up");

	// Reset global state
	testApiKey = null;
	testClient = null;
	setupPromise = null;
	isSetupComplete = false;

	log("🌍 Integration test cleanup completed");
}

/**
 * Global setup - runs once before all test files (when running `make integration`)
 */
beforeAll(async () => {
	log("🌍 Global beforeAll detected - using shared server setup");
	// Just ensure setup is done, lazy initialization will handle it
	await ensureSetup();
});

/**
 * Global teardown - runs once after all test files complete (when running `make integration`)
 */
afterAll(async () => {
	log("🌍 Global afterAll detected - cleaning up shared server");
	await performCleanup();
});

/**
 * Handle process exit gracefully - ensures server cleanup on any exit
 */
const cleanup = async () => {
	await performCleanup();
};

process.on("exit", cleanup);
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
process.on("uncaughtException", cleanup);
process.on("unhandledRejection", cleanup);

/**
 * Start the Hono server for testing - in-process version
 */
async function startHonoServer(): Promise<void> {
	log("🚀 Starting shared Hono server in-process...");

	log(`🔧 Environment variables:`);
	log(`  NODE_ENV: ${process.env.NODE_ENV}`);
	log(`  DATABASE_FILE: ${process.env.DATABASE_FILE}`);
	log(`  DATABASE_URL: ${process.env.DATABASE_URL}`);
	log(`  PORT: 3001`);

	// Import server functions
	const { createApp, migrateDb } = await import("../../packages/server/src/server.js");

	// Run migrations first
	const databaseFile = process.env.DATABASE_FILE;
	if (!databaseFile) {
		throw new Error("DATABASE_FILE environment variable is required");
	}

	log("⌛️ Running database migrations...");
	await migrateDb({
		databaseFile,
		migrationPaths: ["./packages/schema/src/database/drizzle"],
	});
	log("✅ Database migrations completed");

	// Create the Hono app
	const app = createApp({
		runMigrations: false, // Already done above
		enableStatic: false,
		corsOrigins: ["http://localhost:4321", "http://localhost:3000", "http://localhost:5173"],
		port: 3001,
		environment: "test",
	});

	log("🎬 Starting in-process server...");

	// Start the server using Bun.serve
	honoServer = Bun.serve({
		port: 3001,
		fetch: app.fetch,
	});

	log(`📊 Server started in-process on port ${honoServer.port}`);

	// Wait for server to be ready
	await waitForServer("http://localhost:3001/health");
	log("✅ Shared Hono server started and responding");
}
