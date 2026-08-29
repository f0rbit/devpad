import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "@devpad/schema/database/types";
import { create_test_db, seed_user } from "../../../services/graph/__tests__/integration/helpers.js";
import { createApiKey, deleteApiKey, getAPIKeys } from "../../keys.js";

/**
 * v2.4 (B3.4) — real in-memory-SQLite coverage for `deleteApiKey`'s
 * ownership scoping, added alongside the settings page's scoped-keys panel.
 * The pre-existing `keys.test.ts` hand-mocks `db.select`/`.insert` calls;
 * this specifically proves the WHERE clause's owner scoping, which a mock
 * that just echoes its arguments back can't meaningfully exercise.
 */
describe("deleteApiKey — ownership scoping", () => {
	let db: Database;
	let owner_id: string;
	let other_owner_id: string;

	beforeEach(async () => {
		db = create_test_db();
		owner_id = (await seed_user(db)).id;
		other_owner_id = (await seed_user(db)).id;
	});

	test("owner can delete their own key", async () => {
		const created = await createApiKey(db, owner_id);
		if (!created.ok) throw new Error("setup failed");

		const result = await deleteApiKey(db, created.value.key.id, owner_id);
		expect(result.ok).toBe(true);

		const remaining = await getAPIKeys(db, owner_id);
		expect(remaining.ok).toBe(true);
		if (remaining.ok) expect(remaining.value).toHaveLength(0);
	});

	test("a different user cannot delete someone else's key", async () => {
		const created = await createApiKey(db, owner_id);
		if (!created.ok) throw new Error("setup failed");

		const result = await deleteApiKey(db, created.value.key.id, other_owner_id);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.kind).toBe("not_found");

		const remaining = await getAPIKeys(db, owner_id);
		expect(remaining.ok).toBe(true);
		if (remaining.ok) expect(remaining.value).toHaveLength(1);
	});
});
