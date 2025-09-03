/**
 * Integration test setup with global shared server
 * Uses bun's preload feature for single server instance across all tests
 */

import { beforeAll, afterAll } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import ApiClient from "@devpad/api";
import { TEST_USER_ID, DEBUG_LOGGING, log, setupTestDatabase, createTestUser, cleanupTestDatabase, waitForServer } from "../shared/test-utils";

export const TEST_BASE_URL = "http://localhost:3001/api/v0";
export { TEST_USER_ID, DEBUG_LOGGING };

// Global shared server state
let honoServer: any = null;
let testApiKey: string | null = null;
let testClient: ApiClient | null = null;

/**
 * Get the shared API client instance - created during global setup
 */
export function getSharedApiClient(): ApiClient {
	if (!testClient) {
		throw new Error("Shared API client not available. Ensure global setup has run.");
	}
	return testClient;
}

/**
 * Legacy function for backward compatibility - now uses shared client
 */
export async function setupIntegrationTests(): Promise<ApiClient> {
	return getSharedApiClient();
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
 * Global setup - runs once before all test files
 */
beforeAll(async () => {
	log("🌍 Starting global integration test setup...");

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

	log("🌍 Global integration test setup completed - server will remain running for all tests");
});

/**
 * Global teardown - runs once after all test files complete
 */
afterAll(async () => {
	log("🌍 Starting global integration test teardown...");

	// Stop Hono server
	if (honoServer) {
		honoServer.kill("SIGTERM");
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

	log("🌍 Global integration test teardown completed");
});

/**
 * Handle process exit gracefully
 */
const cleanup = async () => {
	if (honoServer) {
		log("🔄 Process exit - cleaning up server...");
		honoServer.kill("SIGTERM");
		const dbPath = path.join(process.cwd(), "database", "test.db");
		cleanupTestDatabase(dbPath);
	}
};

process.on("exit", cleanup);
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

/**
 * Start the Hono server for testing
 */
async function startHonoServer(): Promise<void> {
	log("🚀 Starting shared Hono dev server...");

	const serverDir = path.resolve(path.join(__dirname, "..", "..", "packages", "server"));

	const { spawn } = await import("node:child_process");

	const logFile = fs.createWriteStream(path.join(serverDir, "server.log"), { flags: "a" });

	honoServer = spawn("bun", ["dev"], {
		cwd: serverDir,
		stdio: ["pipe", "pipe", "pipe"],
		env: {
			...process.env,
			NODE_ENV: "test",
			DATABASE_FILE: process.env.DATABASE_FILE,
			DATABASE_URL: process.env.DATABASE_URL,
			PORT: "3001",
			RUN_MIGRATIONS: "true",
		},
	});

	if (!DEBUG_LOGGING) {
		// Pipe stdout and stderr to the log file
		honoServer.stdout?.pipe(logFile);
		honoServer.stderr?.pipe(logFile);
	} else {
		// In debug mode, pipe to console as well
		honoServer.stdout?.on("data", (data: Buffer) => {
			logFile.write(data);
			process.stdout.write(data);
		});
		honoServer.stderr?.on("data", (data: Buffer) => {
			logFile.write(data);
			process.stderr.write(data);
		});
	}

	// Handle process errors
	honoServer.on("error", (error: any) => {
		console.error("❌ Hono server error:", error);
	});

	// Wait for server to be ready
	await waitForServer("http://localhost:3001/health");
	log("✅ Shared Hono server started and responding");
}
