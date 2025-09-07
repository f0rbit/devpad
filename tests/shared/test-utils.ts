import { Database } from "bun:sqlite";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import * as schema from "@devpad/schema/database";
import { api_key, user } from "@devpad/schema";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

export const TEST_USER_ID = "test-user-12345";
export const DEBUG_LOGGING = Bun.env.DEBUG_LOGGING === "true";

export function log(...args: any[]) {
	if (DEBUG_LOGGING) {
		console.log(...args);
	}
}

export async function setupTestDatabase(dbPath: string): Promise<void> {
	const dbDir = path.dirname(dbPath);
	if (!fs.existsSync(dbDir)) {
		fs.mkdirSync(dbDir, { recursive: true });
	}

	if (fs.existsSync(dbPath)) {
		fs.unlinkSync(dbPath);
	}

	log("🗄️ Setting up test database at:", dbPath);

	const sqlite = new Database(dbPath);
	const db = drizzle(sqlite, { schema });

	// Find the project root by looking for package.json
	let currentDir = __dirname;
	while (currentDir !== path.dirname(currentDir)) {
		const packageJsonPath = path.join(currentDir, "package.json");
		if (fs.existsSync(packageJsonPath)) {
			break;
		}
		currentDir = path.dirname(currentDir);
	}

	const migrationsFolder = path.join(currentDir, "packages", "schema", "src", "database", "drizzle");
	log("🔍 Migration folder:", migrationsFolder);

	if (!fs.existsSync(migrationsFolder)) {
		throw new Error(`Migration folder not found: ${migrationsFolder}`);
	}

	migrate(db, { migrationsFolder });

	sqlite.close();
	log("✅ Test database setup complete");
}

export async function createTestUser(dbPath: string): Promise<string> {
	log("👤 Creating test user and API key...");

	const sqlite = new Database(dbPath);
	const db = drizzle(sqlite, { schema });

	try {
		const [testUser] = await db
			.insert(user)
			.values({
				id: TEST_USER_ID,
				name: "Integration Test User",
				email: `test-${Date.now()}@devpad.test`,
				github_id: null,
			})
			.returning();

		const apiKeyValue = crypto.randomBytes(32).toString("hex");
		await db.insert(api_key).values({
			owner_id: testUser.id,
			hash: apiKeyValue,
		});

		sqlite.close();
		log("✅ Test user and API key created");
		return apiKeyValue;
	} catch (error) {
		sqlite.close();
		throw error;
	}
}

export function cleanupTestDatabase(dbPath: string): void {
	if (fs.existsSync(dbPath)) {
		fs.unlinkSync(dbPath);
	}
}

export async function waitForServer(url: string, maxAttempts = 30): Promise<void> {
	let attempts = 0;
	log(`🔄 Waiting for server at ${url} (max ${maxAttempts} attempts)`);

	while (attempts < maxAttempts) {
		try {
			log(`  Attempt ${attempts + 1}/${maxAttempts}: Checking ${url}...`);

			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 3000);

			const response = await fetch(url, {
				signal: controller.signal,
			});

			clearTimeout(timeoutId);

			log(`  Response status: ${response.status} ${response.statusText}`);

			if (response.ok) {
				log("✅ Server started and responding");
				return;
			} else {
				log(`  Server responded but with error status: ${response.status}`);
			}
		} catch (error: any) {
			log(`  Error connecting to server: ${error.name}: ${error.message}`);
			if (error.name === "AbortError") {
				log(`  Request timed out after 3 seconds`);
			} else if (error.code === "ECONNREFUSED") {
				log(`  Connection refused - server not ready yet`);
			}
		}

		log(`  Waiting 1 second before next attempt...`);
		await new Promise(resolve => setTimeout(resolve, 1000));
		attempts++;
	}

	throw new Error(`Server did not start within ${maxAttempts} seconds`);
}
