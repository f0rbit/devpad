import { Database as BunSqlite } from "bun:sqlite";
import { beforeAll, describe, expect, test } from "bun:test";
import path from "node:path";
import type { Project } from "@devpad/schema";
import { project } from "@devpad/schema/database/schema";
import { createBunDatabase } from "@devpad/schema/database/bun";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { setupIntegration } from "../shared/base-integration-test";
import { TestDataFactory } from "./factories";
import { TEST_BASE_URL, TEST_USER_ID } from "./setup";

const webhook_response = z.object({ status: z.string(), completed: z.array(z.string()).optional() });
async function parseWebhookResponse(response: Response) {
	return webhook_response.parse(await response.json());
}

// Matches `dev.ts`'s stable dev-only fallback for GITHUB_WEBHOOK_SECRET —
// deterministic regardless of which integration test file happens to
// trigger the shared server's one-time startup first (bun runs test files
// sequentially, not "load all, then run all", so per-file env mutation
// isn't reliable here).
const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET ?? "dev-github-webhook-secret";

const t = setupIntegration();

async function signBody(body: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(WEBHOOK_SECRET),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
	const hex = Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, "0")).join("");
	return `sha256=${hex}`;
}

async function postWebhook(
	body: string,
	options: { signature?: string; delivery_guid?: string; event_type?: string } = {},
) {
	const signature = options.signature ?? (await signBody(body));
	const headers: Record<string, string> = {
		"content-type": "application/json",
		"x-hub-signature-256": signature,
		"x-github-delivery": options.delivery_guid ?? crypto.randomUUID(),
		"x-github-event": options.event_type ?? "pull_request",
	};
	return fetch(`${TEST_BASE_URL}/github/webhook`, { method: "POST", headers, body });
}

async function setGithubAutoclose(project_id: string, enabled: boolean): Promise<void> {
	const dbPath = path.join(process.cwd(), "database", "test.db");
	const sqlite = new BunSqlite(dbPath);
	const db = createBunDatabase(sqlite);
	await db.update(project).set({ github_autoclose: enabled }).where(eq(project.id, project_id));
	sqlite.close();
}

function mergedPrPayload(html_url: string) {
	return JSON.stringify({ action: "closed", pull_request: { html_url, merged: true } });
}

describe("GitHub App inbound webhook (task A3.6)", () => {
	let test_project: Project;

	beforeAll(async () => {
		const created = await t.client.projects.create(TestDataFactory.createRealisticProject());
		if (!created.ok) throw new Error(`Failed to create project: ${created.error.message}`);
		t.cleanup.registerProject(created.value);
		test_project = created.value;
	});

	test("a bad signature is rejected with 401 before any DB read", async () => {
		const body = mergedPrPayload("https://github.com/acme/widgets/pull/1");
		const response = await postWebhook(body, { signature: "sha256=deadbeef" });
		expect(response.status).toBe(401);
	});

	test("a duplicate delivery (same GUID + body) is a no-op the second time", async () => {
		const delivery_guid = crypto.randomUUID();
		const body = mergedPrPayload("https://github.com/acme/widgets/pull/2");

		const first = await postWebhook(body, { delivery_guid });
		expect(first.status).toBe(200);
		const first_json = await parseWebhookResponse(first);
		expect(first_json.status).not.toBe("duplicate");

		const second = await postWebhook(body, { delivery_guid });
		expect(second.status).toBe(200);
		const second_json = await parseWebhookResponse(second);
		expect(second_json.status).toBe("duplicate");
	});

	test("an unlinked merged PR no-ops", async () => {
		const body = mergedPrPayload("https://github.com/acme/widgets/pull/999999");
		const response = await postWebhook(body);
		expect(response.status).toBe(200);
		const json = await parseWebhookResponse(response);
		expect(json.status).toBe("ignored");
		expect(json.completed).toEqual([]);
	});

	test("a merged PR completes the linked task only when the project opted in via github_autoclose", async () => {
		await setGithubAutoclose(test_project.id, false);

		const created = await t.client.tasks.create({
			title: "task linked to a PR, autoclose OFF",
			project_id: test_project.id,
			owner_id: TEST_USER_ID,
			progress: "UNSTARTED",
			priority: "MEDIUM",
		});
		expect(created.ok).toBe(true);
		if (!created.ok) return;
		t.cleanup.registerTask(created.value);

		const pr_url = `https://github.com/acme/widgets/pull/${String(Date.now())}`;
		const link = await t.client.tasks.link({
			src_id: created.value.task.id,
			dst_id: null,
			kind: "references",
			ref: { type: "pr", url: pr_url },
		});
		expect(link.ok).toBe(true);

		const response = await postWebhook(mergedPrPayload(pr_url));
		expect(response.status).toBe(200);
		const json = await parseWebhookResponse(response);
		expect(json.completed).toEqual([]); // autoclose is off — no-op

		const still_open = await t.client.tasks.find(created.value.task.id);
		expect(still_open.ok).toBe(true);
		if (still_open.ok) expect(still_open.value?.task.progress).toBe("UNSTARTED");

		// Now opt in and replay with a fresh delivery GUID for the same PR.
		await setGithubAutoclose(test_project.id, true);
		const response2 = await postWebhook(mergedPrPayload(pr_url));
		expect(response2.status).toBe(200);
		const json2 = await parseWebhookResponse(response2);
		expect(json2.completed).toEqual([created.value.task.id]);

		const now_completed = await t.client.tasks.find(created.value.task.id);
		expect(now_completed.ok).toBe(true);
		if (now_completed.ok) expect(now_completed.value?.task.progress).toBe("COMPLETED");
	});
});
