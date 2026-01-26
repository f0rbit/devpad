import { describe, expect, test } from "bun:test";
import { createApiKey, deleteApiKey, getAPIKeys, getUserByAPIKey } from "../keys-d1.js";

const createMockDb = (data: { api_keys: Array<{ id: string; owner_id: string; hash: string }> }) => {
	const make_query = (filter_fn?: (rows: any[]) => any[]) => ({
		from: (_table: any) => ({
			where: (_condition: any) => {
				const filtered = filter_fn ? filter_fn(data.api_keys) : data.api_keys;
				return Promise.resolve(filtered);
			},
		}),
	});

	return {
		select: () => make_query(),
		insert: (_table: any) => ({
			values: (values: any) => {
				const new_row = { id: `api_key_${crypto.randomUUID()}`, ...values };
				data.api_keys.push(new_row);
				return {
					returning: () => Promise.resolve([new_row]),
				};
			},
		}),
		delete: (_table: any) => ({
			where: (_condition: any) => ({
				returning: () => Promise.resolve([]),
			}),
		}),
	};
};

describe("getUserByAPIKey", () => {
	test("returns user_id for valid key", async () => {
		const mock_db = {
			select: () => ({
				from: () => ({
					where: () => Promise.resolve([{ owner_id: "user_123", hash: "valid-key", id: "key_1" }]),
				}),
			}),
		};

		const result = await getUserByAPIKey(mock_db, "valid-key");
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value).toBe("user_123");
	});

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

	test("returns multiple_matches when multiple keys match", async () => {
		const mock_db = {
			select: () => ({
				from: () => ({
					where: () =>
						Promise.resolve([
							{ owner_id: "user_1", hash: "dup-key", id: "key_1" },
							{ owner_id: "user_2", hash: "dup-key", id: "key_2" },
						]),
				}),
			}),
		};

		const result = await getUserByAPIKey(mock_db, "dup-key");
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("multiple_matches");
	});

	test("returns database_error on exception", async () => {
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
		expect(result.error.kind).toBe("database_error");
	});
});

describe("getAPIKeys", () => {
	test("returns list of keys for user", async () => {
		const mock_keys = [
			{ id: "key_1", owner_id: "user_1", hash: "h1" },
			{ id: "key_2", owner_id: "user_1", hash: "h2" },
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
