import { describe, expect, test } from "bun:test";
import { createApiKey, deleteApiKey, getAPIKeys, getUserByAPIKey } from "../keys.js";

describe("getUserByAPIKey", () => {
	test("returns not_found for invalid key", async () => {
		const mock_db = {
			select: () => ({
				from: () => ({
					where: () => Promise.resolve([]),
				}),
			}),
		};

		const result = await getUserByAPIKey(mock_db, "nonexistent-key");
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("not_found");
	});

	test("returns user_id for valid key", async () => {
		const mock_db = {
			select: () => ({
				from: () => ({
					where: () => Promise.resolve([{ user_id: "user_123", key_hash: "hashed", id: "key_1" }]),
				}),
			}),
		};

		const result = await getUserByAPIKey(mock_db, "valid-key");
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value).toBe("user_123");
	});

	test("returns conflict when multiple keys match", async () => {
		const mock_db = {
			select: () => ({
				from: () => ({
					where: () =>
						Promise.resolve([
							{ user_id: "user_1", key_hash: "hashed", id: "key_1" },
							{ user_id: "user_2", key_hash: "hashed", id: "key_2" },
						]),
				}),
			}),
		};

		const result = await getUserByAPIKey(mock_db, "dup-key");
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("conflict");
	});

	test("returns db_error on exception", async () => {
		const mock_db = {
			select: () => ({
				from: () => ({
					where: () => Promise.reject(new Error("Connection lost")),
				}),
			}),
		};

		const result = await getUserByAPIKey(mock_db, "any-key");
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("db_error");
	});
});

describe("getAPIKeys", () => {
	test("returns list of keys for user", async () => {
		const mock_keys = [
			{ id: "key_1", user_id: "user_1", key_hash: "h1" },
			{ id: "key_2", user_id: "user_1", key_hash: "h2" },
		];

		const mock_db = {
			select: () => ({
				from: () => ({
					where: () => Promise.resolve(mock_keys),
				}),
			}),
		};

		const result = await getAPIKeys(mock_db, "user_1");
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.length).toBe(2);
	});
});

describe("createApiKey", () => {
	test("returns key and raw_key on success", async () => {
		const mock_db = {
			insert: () => ({
				values: (values: any) => ({
					returning: () => Promise.resolve([{ id: "apikey_123", ...values }]),
				}),
			}),
		};

		const result = await createApiKey(mock_db, "user_1");
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.raw_key).toStartWith("devpad_");
		expect(result.value.key.key_hash).toBeTruthy();
		expect(result.value.key.user_id).toBe("user_1");
	});
});
