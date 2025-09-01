import { Database } from "bun:sqlite";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DevpadApiClient } from "@devpad/api";
import * as schema from "@devpad/schema/database";
import { api_key, user } from "@devpad/schema/database/schema";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

// Test constants
export const TEST_USER_ID = "test-user-12345";
export const TEST_BASE_URL = "http://localhost:3001/api/v0";

// Global test state
let honoServer: any = null;
let testApiKey: string | null = null;
let testClient: DevpadApiClient | null = null;

export async function setupIntegrationTests(): Promise<DevpadApiClient> {
	console.log("🧪 Setting up integration test environment...");

	// Set environment variables early
	const baseDir = path.resolve(process.cwd());
	const dbPath = path.join(baseDir, "database", "test.db");
	process.env.NODE_ENV = "test";
	process.env.DATABASE_URL = `sqlite://${dbPath}`;
	process.env.DATABASE_FILE = dbPath;

	// Only setup database and server once globally
	if (!honoServer) {
		// Setup test database
		await setupTestDatabase();

		// Start Hono server
		await startHonoServer();

		// Create test user and API key (only once)
		testApiKey = await createTestUser(process.env.DATABASE_FILE!);
	} else {
		console.log("✅ Using existing Hono server and test database");
	}

	if (!testApiKey) {
		throw new Error("Test API key not available");
	}

	// Create and return test client
	testClient = new DevpadApiClient({
		base_url: TEST_BASE_URL,
		api_key: testApiKey,
	});

	console.log("✅ Integration test environment ready");
	return testClient;
}

export async function teardownIntegrationTests(): Promise<void> {
	// Clean up server after each test file (but keep database for next test)
	console.log("🧹 Test completed, stopping server");

	// Stop Hono server
	if (honoServer) {
		honoServer.kill("SIGTERM");
		honoServer = null;
		testApiKey = null;
		testClient = null;
	}

	console.log("✅ Server stopped");
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
	console.log("🧹 Final cleanup - stopping server and cleaning database...");

	// Stop Hono server
	if (honoServer) {
		honoServer.kill("SIGTERM");
		honoServer = null;
	}

	// Clean up test database
	await cleanupTestDatabase();

	console.log("✅ Final cleanup completed");
}

async function setupTestDatabase(): Promise<void> {
	const dbPath = process.env.DATABASE_FILE!;

	// Ensure database directory exists
	const dbDir = path.dirname(dbPath);
	if (!fs.existsSync(dbDir)) {
		fs.mkdirSync(dbDir, { recursive: true });
	}

	// Remove existing test database
	if (fs.existsSync(dbPath)) {
		fs.unlinkSync(dbPath);
	}

	console.log("🗄️ Setting up test database at:", dbPath);

	// Run migrations
	const sqlite = new Database(dbPath);
	const db = drizzle(sqlite, { schema });

	const baseDir = path.resolve(__dirname, "..", "..");
	const migrationsFolder = path.join(baseDir, "packages", "schema", "src", "database", "drizzle");
	console.log("🔍 Migration folder:", migrationsFolder);
	migrate(db, { migrationsFolder });

	sqlite.close();

	console.log("✅ Test database setup complete");
}

async function startHonoServer(): Promise<void> {
	console.log("🚀 Starting Hono dev server...");

	const serverDir = path.resolve(path.join(__dirname, "..", "..", "packages", "server"));

	const { spawn } = await import("node:child_process");

	honoServer = spawn("bun", ["dev"], {
		cwd: serverDir,
		stdio: "pipe",
		env: {
			...process.env,
			NODE_ENV: "test",
			DATABASE_FILE: process.env.DATABASE_FILE,
			DATABASE_URL: process.env.DATABASE_URL,
			PORT: "3001",
		},
	});

	// Handle process errors
	honoServer.on("error", (error: any) => {
		console.error("❌ Hono server error:", error);
	});

	// Wait for server to be ready by polling the health endpoint
	let attempts = 0;
	const maxAttempts = 30;

	while (attempts < maxAttempts) {
		try {
			const response = await fetch("http://localhost:3001/health", {
				signal: AbortSignal.timeout(2000),
			});
			if (response.ok) {
				console.log("✅ Hono dev server started and responding");
				return;
			}
		} catch (_error) {
			// Server not ready yet, continue waiting
		}

		await new Promise(resolve => setTimeout(resolve, 1000));
		attempts++;
	}

	throw new Error(`Hono server did not start within ${maxAttempts} seconds`);
}

async function createTestUser(dbPath: string): Promise<string> {
	console.log("👤 Creating test user and API key...");

	const sqlite = new Database(dbPath);
	const db = drizzle(sqlite, { schema });

	try {
		// Create test user
		const [testUser] = await db
			.insert(user)
			.values({
				id: TEST_USER_ID,
				name: "Integration Test User",
				email: `test-${Date.now()}@devpad.test`,
				github_id: null,
			})
			.returning();

		// Create API key
		const apiKeyValue = crypto.randomBytes(32).toString("hex");
		await db.insert(api_key).values({
			owner_id: testUser.id,
			hash: apiKeyValue,
		});

		sqlite.close();

		console.log("✅ Test user and API key created");
		return apiKeyValue;
	} catch (error) {
		sqlite.close();
		throw error;
	}
}

async function cleanupTestDatabase(): Promise<void> {
	const dbPath = path.join(process.cwd(), "database", "test.db");
	if (fs.existsSync(dbPath)) {
		fs.unlinkSync(dbPath);
	}
}

export { testClient };
