import { Database as BunSqlite } from "bun:sqlite";
import { beforeAll, describe, expect, test } from "bun:test";
import path from "node:path";
import type { PublicHook } from "@devpad/api";
import { hook_delivery } from "@devpad/schema";
import { createBunDatabase } from "@devpad/schema/database/bun";
import type { Project } from "@devpad/schema";
import type { UpsertHook } from "@devpad/schema/validation";
import { setupIntegration } from "../shared/base-integration-test";
import { TestDataFactory } from "./factories";

const t = setupIntegration();

function webhookTrigger(): UpsertHook["trigger"] {
	return { kinds: ["task.completed"], selector: {} };
}

describe("Hook registry CRUD (task A3.2)", () => {
	let project: Project;

	beforeAll(async () => {
		const created = await t.client.projects.create(TestDataFactory.createRealisticProject());
		if (!created.ok) throw new Error(`Failed to create project: ${created.error.message}`);
		t.cleanup.registerProject(created.value);
		project = created.value;
	});

	test("creates a webhook hook and never returns the secret", async () => {
		const created = await t.client.hooks.upsert({
			project_id: project.id,
			enabled: true,
			trigger: webhookTrigger(),
			action: { kind: "webhook", url: "https://example.com/devpad-hook", secret: "super-secret-value" },
		});
		expect(created.ok).toBe(true);
		if (!created.ok) return;

		const hook: PublicHook = created.value;
		expect(hook.action.kind).toBe("webhook");
		if (hook.action.kind !== "webhook") return;
		expect(hook.action.has_secret).toBe(true);
		expect(JSON.stringify(hook)).not.toContain("super-secret-value");
		expect(JSON.stringify(hook)).not.toContain("secret_encrypted");
	});

	test("round-trips through list and update", async () => {
		const created = await t.client.hooks.upsert({
			project_id: project.id,
			enabled: true,
			trigger: webhookTrigger(),
			action: { kind: "pipeline", package_id: "anthropic-search" },
		});
		expect(created.ok).toBe(true);
		if (!created.ok) return;

		const listed = await t.client.hooks.list(project.id);
		expect(listed.ok).toBe(true);
		if (!listed.ok) return;
		expect(listed.value.some((h) => h.id === created.value.id)).toBe(true);

		const updated = await t.client.hooks.upsert({
			id: created.value.id,
			project_id: project.id,
			enabled: false,
			trigger: { kinds: ["node.children_all_done"], selector: {} },
			action: { kind: "pipeline", package_id: "anthropic-search" },
		});
		expect(updated.ok).toBe(true);
		if (!updated.ok) return;
		expect(updated.value.enabled).toBe(false);
		expect(updated.value.trigger.kinds).toEqual(["node.children_all_done"]);
	});

	test("rejects a malformed action union", async () => {
		const result = await t.client.hooks.upsert({
			project_id: project.id,
			enabled: true,
			trigger: webhookTrigger(),
			// Missing `url`, which `hook_action_input`'s webhook variant requires.
			action: { kind: "webhook" } as unknown as UpsertHook["action"],
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code === "VALIDATION_ERROR" || result.error.status_code === 400).toBe(true);
	});

	test("deletes a hook", async () => {
		const created = await t.client.hooks.upsert({
			project_id: project.id,
			enabled: true,
			trigger: webhookTrigger(),
			action: { kind: "vault", scope: "github:releases:example/repo", op: "create_release" },
		});
		expect(created.ok).toBe(true);
		if (!created.ok) return;

		const deleted = await t.client.hooks.delete(created.value.id);
		expect(deleted.ok).toBe(true);

		const listed = await t.client.hooks.list(project.id);
		expect(listed.ok).toBe(true);
		if (!listed.ok) return;
		expect(listed.value.some((h) => h.id === created.value.id)).toBe(false);
	});

	test("deliveries are filterable by status, including the failed_permanent DLQ", async () => {
		const created = await t.client.hooks.upsert({
			project_id: project.id,
			enabled: true,
			trigger: webhookTrigger(),
			action: { kind: "pipeline", package_id: "anthropic-search" },
		});
		expect(created.ok).toBe(true);
		if (!created.ok) return;

		const dbPath = path.join(process.cwd(), "database", "test.db");
		const sqlite = new BunSqlite(dbPath);
		const db = createBunDatabase(sqlite);
		await db.insert(hook_delivery).values([
			{
				id: `hdl_${crypto.randomUUID()}`,
				hook_id: created.value.id,
				event_id: `evt_${crypto.randomUUID()}`,
				status: "delivered",
			},
			{
				id: `hdl_${crypto.randomUUID()}`,
				hook_id: created.value.id,
				event_id: `evt_${crypto.randomUUID()}`,
				status: "failed_permanent",
				last_error: "upstream 500",
			},
		]);
		sqlite.close();

		const all = await t.client.hooks.deliveries(created.value.id);
		expect(all.ok).toBe(true);
		if (all.ok) expect(all.value.length).toBe(2);

		const dlq = await t.client.hooks.deliveries(created.value.id, "failed_permanent");
		expect(dlq.ok).toBe(true);
		if (!dlq.ok) return;
		expect(dlq.value.length).toBe(1);
		expect(dlq.value[0]?.status).toBe("failed_permanent");
	});
});
