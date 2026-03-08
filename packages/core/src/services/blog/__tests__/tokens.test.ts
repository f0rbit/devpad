import { describe, expect, test } from "bun:test";
import { createTokenService, token } from "../tokens";

const mockTokenRow = (overrides: Partial<Record<string, any>> = {}) => ({
	id: "apikey_abc123",
	user_id: "user_1",
	key_hash: "hashed_value_abc",
	name: "My Token",
	note: "test note",
	enabled: true,
	created_at: "2024-01-01T00:00:00Z",
	scope: "blog",
	deleted: false,
	...overrides,
});

function createMockDb(opts: { selectResults?: any[][]; returning?: any[] } = {}) {
	let selectCallIndex = 0;
	const selectResults = opts.selectResults ?? [[]];

	const makeChain = (): any => {
		const chain: any = {
			from: () => chain,
			where: () => chain,
			orderBy: () => chain,
			limit: () => chain,
			leftJoin: () => chain,
			innerJoin: () => chain,
			groupBy: () => chain,
			set: () => chain,
			values: () => ({
				...chain,
				returning: () => Promise.resolve(opts.returning ?? []),
			}),
			returning: () => Promise.resolve(opts.returning ?? []),
			then: (resolve: Function) => {
				const idx = selectCallIndex++;
				resolve(selectResults[idx] ?? []);
			},
		};
		return chain;
	};

	return {
		select: () => makeChain(),
		insert: () => {
			const chain = makeChain();
			return {
				...chain,
				values: () => ({
					...chain,
					returning: () => Promise.resolve(opts.returning ?? []),
				}),
			};
		},
		update: () => {
			const chain = makeChain();
			return {
				...chain,
				set: () => ({
					...chain,
					where: () => ({
						...chain,
						returning: () => Promise.resolve(opts.returning ?? []),
					}),
				}),
			};
		},
		delete: () => makeChain(),
	} as any;
}

describe("token (pure)", () => {
	describe("sanitize", () => {
		test("strips key_hash from row", () => {
			const row = mockTokenRow();
			const sanitized = token.sanitize(row as any);
			expect(sanitized).not.toHaveProperty("key_hash");
			expect(sanitized).not.toHaveProperty("user_id");
			expect(sanitized.id).toBe("apikey_abc123");
			expect(sanitized.name).toBe("My Token");
			expect(sanitized.note).toBe("test note");
			expect(sanitized.enabled).toBe(true);
		});

		test("preserves null note", () => {
			const row = mockTokenRow({ note: null });
			const sanitized = token.sanitize(row as any);
			expect(sanitized.note).toBeNull();
		});
	});

	describe("generate", () => {
		test("returns string starting with blog_", () => {
			const key = token.generate();
			expect(key.startsWith("blog_")).toBe(true);
		});

		test("generates unique values", () => {
			const keys = Array.from({ length: 10 }, () => token.generate());
			const unique = new Set(keys);
			expect(unique.size).toBe(10);
		});
	});
});

describe("createTokenService", () => {
	describe("list", () => {
		test("returns sanitized tokens", async () => {
			const rows = [mockTokenRow(), mockTokenRow({ id: "apikey_def456", name: "Other" })];
			const db = createMockDb({ selectResults: [rows] });
			const service = createTokenService({ db });

			const result = await service.list("user_1");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toHaveLength(2);
				expect(result.value[0]).not.toHaveProperty("key_hash");
				expect(result.value[1]).not.toHaveProperty("key_hash");
			}
		});

		test("returns empty array when no tokens exist", async () => {
			const db = createMockDb({ selectResults: [[]] });
			const service = createTokenService({ db });

			const result = await service.list("user_1");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toEqual([]);
			}
		});
	});

	describe("find", () => {
		test("returns token when found", async () => {
			const row = mockTokenRow();
			const db = createMockDb({ selectResults: [[row]] });
			const service = createTokenService({ db });

			const result = await service.find("user_1", "apikey_abc123");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.id).toBe("apikey_abc123");
			}
		});

		test("returns not_found when token does not exist", async () => {
			const db = createMockDb({ selectResults: [[]] });
			const service = createTokenService({ db });

			const result = await service.find("user_1", "apikey_missing");
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("not_found");
			}
		});
	});

	describe("create", () => {
		test("returns created token with plaintext key", async () => {
			const row = mockTokenRow();
			const db = createMockDb({ returning: [row] });
			const service = createTokenService({ db });

			const result = await service.create("user_1", { name: "New Token" });
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.token.startsWith("blog_")).toBe(true);
				expect(result.value.name).toBe("My Token");
				expect(result.value).not.toHaveProperty("key_hash");
			}
		});

		test("creates token with optional note", async () => {
			const row = mockTokenRow({ note: "my note" });
			const db = createMockDb({ returning: [row] });
			const service = createTokenService({ db });

			const result = await service.create("user_1", { name: "New Token", note: "my note" });
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.note).toBe("my note");
			}
		});
	});

	describe("delete", () => {
		test("soft-deletes token successfully", async () => {
			const row = mockTokenRow();
			const db = createMockDb({ selectResults: [[row]] });
			const service = createTokenService({ db });

			const result = await service.delete("user_1", "apikey_abc123");
			expect(result.ok).toBe(true);
		});

		test("returns not_found when token does not exist", async () => {
			const db = createMockDb({ selectResults: [[]] });
			const service = createTokenService({ db });

			const result = await service.delete("user_1", "apikey_missing");
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("not_found");
			}
		});
	});

	describe("update", () => {
		test("returns not_found when token does not exist", async () => {
			const db = createMockDb({ selectResults: [[]] });
			const service = createTokenService({ db });

			const result = await service.update("user_1", "missing", { name: "Updated" });
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("not_found");
			}
		});

		test("returns unchanged token when no fields provided", async () => {
			const row = mockTokenRow();
			const db = createMockDb({ selectResults: [[row]] });
			const service = createTokenService({ db });

			const result = await service.update("user_1", "apikey_abc123", {});
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.name).toBe("My Token");
				expect(result.value).not.toHaveProperty("key_hash");
			}
		});

		test("updates token fields successfully", async () => {
			const row = mockTokenRow();
			const updated = mockTokenRow({ name: "Updated Name" });
			const db = createMockDb({ selectResults: [[row]], returning: [updated] });
			const service = createTokenService({ db });

			const result = await service.update("user_1", "apikey_abc123", { name: "Updated Name" });
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.name).toBe("Updated Name");
			}
		});
	});
});
