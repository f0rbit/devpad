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

/** Build a shallow copy of `obj` with `keys` removed — e.g. stripping server-managed fields before an upsert call. */
export function omit<T extends Record<string, unknown>, K extends keyof T>(obj: T, keys: readonly K[]): Omit<T, K> {
	const result = { ...obj };
	for (const key of keys) Reflect.deleteProperty(result, key);
	return result;
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
				email: `test-${String(Date.now())}@devpad.test`,
				// Must be non-null: authMiddleware's API-key path requires a real
				// github_id/name (mirrors the session-auth path's pre-existing
				// check) since every real devpad user signs up via GitHub OAuth.
				// A null github_id here silently fails every authenticated
				// integration test with 401 "Invalid or expired API key".
				github_id: 900_000_000,
			})
			.returning();

		const apiKeyValue = `devpad_${crypto.randomUUID()}`;
		const encoder = new TextEncoder();
		const data = encoder.encode(apiKeyValue);
		const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", data);
		const keyHash = Array.from(new Uint8Array(hashBuffer))
			.map((b) => b.toString(16).padStart(2, "0"))
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
	log(`🔄 Waiting for server at ${url} (max ${String(maxAttempts)} attempts)`);

	while (attempts < maxAttempts) {
		try {
			log(`  Attempt ${String(attempts + 1)}/${String(maxAttempts)}: Checking ${url}...`);

			const controller = new AbortController();
			const timeoutId = setTimeout(() => {
				controller.abort();
			}, 3000);

			const response = await fetch(url, {
				signal: controller.signal,
			});

			clearTimeout(timeoutId);

			log(`  Response status: ${String(response.status)} ${response.statusText}`);

			if (response.ok) {
				log("✅ Server started and responding");
				return;
			}
			log(`  Server responded but with error status: ${String(response.status)}`);
		} catch (error: any) {
			log(`  Error connecting to server: ${String(error.name)}: ${String(error.message)}`);
			if (error.name === "AbortError") {
				log(`  Request timed out after 3 seconds`);
			} else if (error.code === "ECONNREFUSED") {
				log(`  Connection refused - server not ready yet`);
			}
		}

		log(`  Waiting 1 second before next attempt...`);
		await new Promise((resolve) => setTimeout(resolve, 1000));
		attempts++;
	}

	throw new Error(`Server did not start within ${String(maxAttempts)} seconds`);
}
