import { Database } from "bun:sqlite";
import crypto from "node:crypto";
import fs from "node:fs";
import { api_keys, user } from "@devpad/schema";
import { createBunDatabase } from "@devpad/schema/database/bun";

export const TEST_USER_ID = "test-user-12345";
export const DEBUG_LOGGING = Bun.env.DEBUG_LOGGING === "true";

export function log(...args: any[]) {
	if (DEBUG_LOGGING) {
		console.log(...args);
	}
}

export async function createTestUser(dbPath: string): Promise<string> {
	log("👤 Creating test user and API key...");

	const sqlite = new Database(dbPath);
	const db = createBunDatabase(sqlite);

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

		const apiKeyValue = `devpad_${crypto.randomUUID()}`;
		const encoder = new TextEncoder();
		const data = encoder.encode(apiKeyValue);
		const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", data);
		const keyHash = Array.from(new Uint8Array(hashBuffer))
			.map(b => b.toString(16).padStart(2, "0"))
			.join("");

		await db.insert(api_keys).values({
			user_id: testUser.id,
			key_hash: keyHash,
			scope: "devpad",
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
