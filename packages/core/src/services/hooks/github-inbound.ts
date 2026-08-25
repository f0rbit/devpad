/**
 * @module core/services/hooks/github-inbound
 *
 * v2.4 (task A3.6) — the GitHub App inbound webhook receiver's pure logic.
 * `pull_request.closed[merged]` completes every task holding a dangling
 * `references` edge (`ref: {type:"pr", url}`) to that PR, but only for
 * projects that opted in via `project.github_autoclose` (OFF by default —
 * diff-linked status because agents are unreliable narrators).
 *
 * Idempotency: PK = sha256(`${delivery_guid}:${raw_body}`), copying the
 * pipelines `events.ts` content-hash pattern — a GitHub delivery retry
 * (same GUID, same body) is a no-op; a GUID somehow reused with different
 * content is treated as a new, distinct delivery rather than silently
 * dropped.
 *
 * Signature verification lives here too (`verify_github_signature`) so the
 * worker route can reject a bad signature before touching the database at
 * all, per the phase's adversary checklist.
 */

import type { Database } from "@devpad/schema/database/types";
import { github_webhook_event, project, task_link } from "@devpad/schema/database/schema";
import { external_ref } from "@devpad/schema/validation";
import { ok, try_catch_async, type Result } from "@f0rbit/corpus";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { ServiceError } from "../errors.js";
import { get_task_row } from "../graph/graph.js";
import { SqlCompletionEngine } from "../graph/completion.js";

function hex_to_bytes(hex: string): Uint8Array | null {
	if (hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) return null;
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	}
	return bytes;
}

/**
 * Constant-time signature check — `crypto.subtle.verify` itself does the
 * timing-safe comparison, so this never hand-rolls one. Rejects (returns
 * `false`) on any malformed input before touching the secret/body compare.
 */
export async function verify_github_signature(
	secret: string,
	raw_body: string,
	signature_header: string | null,
): Promise<boolean> {
	if (!signature_header?.startsWith("sha256=")) return false;
	const signature_bytes = hex_to_bytes(signature_header.slice("sha256=".length));
	if (!signature_bytes) return false;

	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["verify"],
	);
	return crypto.subtle.verify("HMAC", key, signature_bytes, new TextEncoder().encode(raw_body));
}

async function content_hash(delivery_guid: string, raw_body: string): Promise<string> {
	const bytes = new TextEncoder().encode(`${delivery_guid}:${raw_body}`);
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export type GithubWebhookEnvelope = { delivery_guid: string; event_type: string; raw_body: string };

export type WebhookOutcome = { status: "duplicate" | "ignored" | "completed"; task_ids: string[] };

const pull_request_payload = z.object({
	action: z.string().optional(),
	pull_request: z.object({ html_url: z.string().optional(), merged: z.boolean().optional() }).optional(),
});

export async function process_github_webhook(
	db: Database,
	envelope: GithubWebhookEnvelope,
): Promise<Result<WebhookOutcome, ServiceError>> {
	const id = await content_hash(envelope.delivery_guid, envelope.raw_body);
	const inserted = await db
		.insert(github_webhook_event)
		.values({ id, delivery_guid: envelope.delivery_guid, event_type: envelope.event_type })
		.onConflictDoNothing()
		.returning();
	if (inserted.length === 0) return ok({ status: "duplicate", task_ids: [] });

	if (envelope.event_type !== "pull_request") return ok({ status: "ignored", task_ids: [] });

	// Explicit `async (): Promise<unknown>` return type is what satisfies
	// f0rbit/require-schema-at-boundary — the zod parse right after is the
	// validation the rule wants to see.
	const parse_raw = async (): Promise<unknown> => JSON.parse(envelope.raw_body);
	const raw_json = await try_catch_async(parse_raw, () => null);
	if (!raw_json.ok) return ok({ status: "ignored", task_ids: [] });
	const payload_parsed = pull_request_payload.safeParse(raw_json.value);
	if (!payload_parsed.success) return ok({ status: "ignored", task_ids: [] });
	const payload = payload_parsed.data;

	const pr_url = payload.pull_request?.html_url;
	if (payload.action !== "closed" || !payload.pull_request?.merged || !pr_url) {
		return ok({ status: "ignored", task_ids: [] });
	}

	const link_rows = await db
		.select()
		.from(task_link)
		.where(and(eq(task_link.kind, "references"), eq(task_link.deleted, false)));

	const matching_src_ids = link_rows
		.filter((row) => {
			const parsed = external_ref.safeParse(row.ref);
			return parsed.success && parsed.data.type === "pr" && parsed.data.url === pr_url;
		})
		.map((row) => row.src_id);

	const completed_ids: string[] = [];
	for (const src_id of matching_src_ids) {
		const task_row = await get_task_row(db, src_id);
		if (!task_row || task_row.deleted || task_row.progress === "COMPLETED" || !task_row.project_id) continue;

		const project_rows = await db.select().from(project).where(eq(project.id, task_row.project_id));
		if (!project_rows[0]?.github_autoclose) continue;

		const engine = new SqlCompletionEngine(db);
		const complete_result = await engine.complete(task_row.id, "github", task_row.rev);
		if (complete_result.ok) completed_ids.push(task_row.id);
	}

	return ok({ status: completed_ids.length > 0 ? "completed" : "ignored", task_ids: completed_ids });
}
