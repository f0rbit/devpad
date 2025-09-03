import fs from "node:fs";
import path from "node:path";
import { DevpadApiClient } from "@devpad/api";
import { TEST_USER_ID, DEBUG_LOGGING, log, setupTestDatabase, createTestUser, cleanupTestDatabase, waitForServer } from "../shared/test-utils";

export const TEST_BASE_URL = "http://localhost:3001/api/v0";
export { TEST_USER_ID, DEBUG_LOGGING };

// Global test state
let honoServer: any = null;
let testApiKey: string | null = null;
let testClient: DevpadApiClient | null = null;
let teardownTimeout: NodeJS.Timeout | null = null;

export async function setupIntegrationTests(): Promise<DevpadApiClient> {
	if (teardownTimeout) {
		clearTimeout(teardownTimeout);
		teardownTimeout = null;
	}
	log("🧪 Setting up integration test environment...");

	// Set environment variables early
	const baseDir = path.resolve(process.cwd());
	const dbPath = path.join(baseDir, "database", "test.db");
	process.env.NODE_ENV = "test";
	process.env.DATABASE_URL = `sqlite://${dbPath}`;
	process.env.DATABASE_FILE = dbPath;

	// Only setup database and server once globally
	if (!honoServer) {
		// Setup test database
		await setupTestDatabase(dbPath);

		// Start Hono server
		await startHonoServer();

		// Create test user and API key (only once)
		testApiKey = await createTestUser(dbPath);
	} else {
		log("✅ Using existing Hono server and test database");
	}

	if (!testApiKey) {
		throw new Error("Test API key not available");
	}

	// Create and return test client
	testClient = new DevpadApiClient({
		base_url: TEST_BASE_URL,
		api_key: testApiKey,
	});

	log("✅ Integration test environment ready");
	return testClient;
}

export async function teardownIntegrationTests(): Promise<void> {
	if (teardownTimeout) return;

	// Clean up server after each test file (but keep database for next test)
	log("🧹 Test completed, stopping server");

	// Stop Hono server
	if (honoServer) {
		honoServer.kill("SIGTERM");
		honoServer = null;
		testApiKey = null;
		testClient = null;
	}

	log("✅ Server stopped");
}

// Set up process exit handler to cleanup database when test process ends
process.on("exit", () => {
	if (honoServer) {
		honoServer.kill("SIGTERM");
	}
});

process.on("SIGINT", async () => {
	await finalCleanup();
	process.exit(0);
});

process.on("SIGTERM", async () => {
	await finalCleanup();
	process.exit(0);
});

// Export function to manually cleanup server when all tests are done
export async function finalCleanup(): Promise<void> {
	log("🧹 Final cleanup - stopping server and cleaning database...");

	// Stop Hono server
	if (honoServer) {
		honoServer.kill("SIGTERM");
		honoServer = null;
	}

	// Clean up test database
	const dbPath = path.join(process.cwd(), "database", "test.db");
	cleanupTestDatabase(dbPath);

	log("✅ Final cleanup completed");
}

async function startHonoServer(): Promise<void> {
	log("🚀 Starting Hono dev server...");

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

	// pipe console.error into log file as well
	console.error = function (...args) {
		logFile.write(args.map(a => (typeof a === "string" ? a : JSON.stringify(a))).join(" ") + "\n");
		process.stderr.write(args.map(a => (typeof a === "string" ? a : JSON.stringify(a))).join(" ") + "\n");
	};

	if (!DEBUG_LOGGING) {
		// Pipe stdout and stderr to the log file
		honoServer.stdout?.pipe(logFile);
		honoServer.stderr?.pipe(logFile);

		// Override console.error to log to file
		console.error = function (...args) {
			logFile.write(args.map(a => (typeof a === "string" ? a : JSON.stringify(a))).join(" ") + "\n");
			process.stderr.write(args.map(a => (typeof a === "string" ? a : JSON.stringify(a))).join(" ") + "\n");
		};
	}

	// Handle process errors
	honoServer.on("error", (error: any) => {
		console.error("❌ Hono server error:", error);
	});

	// Wait for server to be ready
	await waitForServer("http://localhost:3001/health");
	log("✅ Hono dev server started and responding");
}

export { testClient };
