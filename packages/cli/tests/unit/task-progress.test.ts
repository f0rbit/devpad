/**
 * Unit tests for src/task-progress.ts — the CLI's single source of truth
 * for status→progress mapping and owner_id resolution against the live
 * API's `upsert_todo` contract (UNSTARTED | IN_PROGRESS | COMPLETED).
 */

import type { ApiClient } from "@devpad/api";
import { describe, expect, test } from "bun:test";
import { resolve_owner_id, task_status_to_progress } from "../../src/task-progress";

const fake_client = (me: ApiClient["user"]["me"]): ApiClient => ({ user: { me } }) as unknown as ApiClient;

describe("task_status_to_progress", () => {
	test("maps CLI status strings to the live API's progress enum", () => {
		expect(task_status_to_progress("todo")).toBe("UNSTARTED");
		expect(task_status_to_progress("in_progress")).toBe("IN_PROGRESS");
		expect(task_status_to_progress("done")).toBe("COMPLETED");
	});

	test("returns undefined for missing or unrecognised status", () => {
		expect(task_status_to_progress(undefined)).toBeUndefined();
		expect(task_status_to_progress("bogus")).toBeUndefined();
	});
});

describe("resolve_owner_id", () => {
	test("returns the authenticated user's id on success", async () => {
		const client = fake_client(async () => ({
			ok: true,
			value: { id: "user_1", name: null, github_id: null, task_view: "list" },
		}));

		expect(await resolve_owner_id(client)).toBe("user_1");
	});

	test("throws with the API's error message on failure", async () => {
		const client = fake_client(async () => ({ ok: false, error: { message: "Unauthorized" } }));

		// Not `.rejects.toThrow()` — bun-types declares `.rejects`/`.toThrow()` as
		// synchronous (`void`), which trips `await-thenable` +
		// `no-confusing-void-expression` even though the chain is genuinely
		// async at runtime. A plain try/catch stays honest to the types.
		let message: string | undefined;
		try {
			await resolve_owner_id(client);
		} catch (error) {
			message = error instanceof Error ? error.message : undefined;
		}
		expect(message).toBe("Failed to resolve current user: Unauthorized");
	});
});
