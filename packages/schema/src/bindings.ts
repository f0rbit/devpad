import { z } from "zod";

export const AuthUserSchema = z
	.object({
		id: z.string(),
		github_id: z.number(),
		name: z.string(),
		task_view: z.union([z.literal("list"), z.literal("grid")]),
	})
	.nullable();

export type AuthUser = z.infer<typeof AuthUserSchema>;

export type HooksQueueMessage = { event_id: string };

// v2.4 (task A3.4/A3.5) — the vault GitHubProxy RPC contract. Defined once
// here so devpad's caller-side type (worker's VAULT_GITHUB binding + the
// vault action executor) and vault's `GitHubVault` WorkerEntrypoint
// implement against the exact same shape.
export type VaultCallerIdentity = { package_id: string; environment: string };
export type VaultRpcResult<T> = { ok: true; value: T } | { ok: false; error: { kind: string; message?: string } };
export type GitHubVaultBinding = {
	create_release(
		input: Record<string, unknown>,
		identity: VaultCallerIdentity,
	): Promise<VaultRpcResult<{ id: number; html_url: string }>>;
	get_latest_release(
		input: Record<string, unknown>,
		identity: VaultCallerIdentity,
	): Promise<VaultRpcResult<{ id: number; tag_name: string; html_url: string }>>;
};

export type Bindings = {
	DB?: D1Database;
	BLOG_CORPUS_BUCKET?: R2Bucket;
	MEDIA_CORPUS_BUCKET?: R2Bucket;
	// v2.4 (task A4.1) — the doc store's corpus bucket (`devpad-corpus` per
	// wrangler.toml). Absent in bun dev/tests, where the worker falls back to
	// `create_memory_backend()` the same way blog/media do.
	DOCS_CORPUS_BUCKET?: R2Bucket;
	// v2.4 (task A3.3) — bound in production/preview via wrangler.toml
	// (`devpad-hooks`/`devpad-hooks-preview`); absent in bun dev/tests, where
	// the worker falls back to `InMemoryDispatcher` running the consumer
	// synchronously.
	HOOKS_QUEUE?: Queue<HooksQueueMessage>;
	// v2.4 (task A3.4) — service binding to vault's `GitHubVault` entrypoint
	// (companion PR, `~/dev/vault`). Absent until that PR is deployed and the
	// binding is wired in wrangler.toml; the vault action executor treats a
	// missing binding as "vault actions not configured" (permanent failure,
	// not a retry loop).
	VAULT_GITHUB?: GitHubVaultBinding;
	PIPELINES_API_BASE?: string;
	PIPELINES_TOKEN?: string;
	// v2.4 (task A3.6) — GitHub App webhook signing secret. Absent means the
	// inbound receiver rejects every request with a clean 501, not a crash
	// (the App itself is a user ops prerequisite, documented in AGENTS.md).
	GITHUB_WEBHOOK_SECRET?: string;
	ENVIRONMENT: string;
	API_URL: string;
	FRONTEND_URL: string;
	GITHUB_CLIENT_ID: string;
	GITHUB_CLIENT_SECRET: string;
	JWT_SECRET: string;
	ENCRYPTION_KEY: string;
	REDDIT_CLIENT_ID: string;
	REDDIT_CLIENT_SECRET: string;
	TWITTER_CLIENT_ID: string;
	TWITTER_CLIENT_SECRET: string;
	PULSE_API_BASE?: string;
	PULSE_INTERNAL_KEY?: string;
	PULSE_DEVPAD_INGEST_KEY?: string;
	DEVPAD_PROJECT_ID?: string;
	GIT_SHA?: string;
};
