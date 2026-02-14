/**
 * Integration test setup with global shared server
 * Uses bun's preload feature for single server instance across all tests
 */

import { afterAll, beforeAll } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import ApiClient from "@devpad/api";
import { cleanupTestDatabase, createTestUser, DEBUG_LOGGING, log, TEST_USER_ID, waitForServer } from "../shared/test-utils";

export const TEST_BASE_URL = "http://localhost:3001/api/v1";
export { TEST_USER_ID, DEBUG_LOGGING };

// Global shared server state
let honoServer: ReturnType<typeof Bun.serve> | null = null;
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

	const dbDir = path.dirname(dbPath);
	if (!fs.existsSync(dbDir)) {
		fs.mkdirSync(dbDir, { recursive: true });
	}
	if (fs.existsSync(dbPath)) {
		fs.unlinkSync(dbPath);
	}

	await startHonoServer();
	log("Hono server started and ready");

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

async function startHonoServer(): Promise<void> {
	log("Starting shared Hono server in-process...");

	const databaseFile = process.env.DATABASE_FILE;
	if (!databaseFile) {
		throw new Error("DATABASE_FILE environment variable is required");
	}

	const { createBunApp, migrateBunDb } = await import("../../packages/worker/src/dev.js");

	migrateBunDb({ database_file: databaseFile, migration_paths: ["./packages/schema/src/database/drizzle"] });
	const { fetch } = createBunApp({ database_file: databaseFile });

	honoServer = Bun.serve({ port: 3001, fetch });

	await waitForServer("http://localhost:3001/health");
	log("Hono server started and responding");
}
