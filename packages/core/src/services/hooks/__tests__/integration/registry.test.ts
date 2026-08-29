import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "@devpad/schema/database/types";
import { get_hook, set_hook_enabled, upsert_hook } from "../../registry.js";
import { create_test_db, seed_project, seed_user } from "./helpers.js";

const ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";

/** v2.4 (B3.4) — the settings panel's enable/disable toggle: a single-column update that must never touch a webhook's `secret_encrypted`. */
describe("set_hook_enabled", () => {
	let db: Database;
	let project_id: string;

	beforeEach(async () => {
		db = create_test_db();
		const owner = await seed_user(db);
		const project = await seed_project(db, owner.id);
		project_id = project.id;
	});

	test("flips enabled without touching the webhook secret", async () => {
		const created = await upsert_hook(db, ENCRYPTION_KEY, {
			project_id,
			enabled: true,
			trigger: { kinds: ["task.completed"], selector: {} },
			action: { kind: "webhook", url: "https://example.com/hook", secret: "shh" },
		});
		if (!created.ok) throw new Error("setup failed");
		expect(created.value.action.kind === "webhook" && created.value.action.has_secret).toBe(true);

		const disabled = await set_hook_enabled(db, created.value.id, project_id, false);
		expect(disabled.ok).toBe(true);
		if (!disabled.ok) return;
		expect(disabled.value.enabled).toBe(false);
		expect(disabled.value.action.kind === "webhook" && disabled.value.action.has_secret).toBe(true);

		const raw = await get_hook(db, created.value.id);
		expect(raw.ok).toBe(true);
		if (raw.ok) {
			const action = raw.value.action as { secret_encrypted?: string };
			expect(action.secret_encrypted).toBeTruthy();
		}
	});

	test("not_found for a hook belonging to a different project", async () => {
		const other_project = await seed_project(db, (await seed_user(db)).id);
		const created = await upsert_hook(db, ENCRYPTION_KEY, {
			project_id,
			enabled: true,
			trigger: { kinds: ["task.completed"], selector: {} },
			action: { kind: "webhook", url: "https://example.com/hook" },
		});
		if (!created.ok) throw new Error("setup failed");

		const result = await set_hook_enabled(db, created.value.id, other_project.id, false);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.kind).toBe("not_found");
	});
});
