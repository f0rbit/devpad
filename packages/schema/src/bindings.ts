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

export type Bindings = {
	DB?: D1Database;
	BLOG_CORPUS_BUCKET?: R2Bucket;
	MEDIA_CORPUS_BUCKET?: R2Bucket;
	// v2.4 (task A3.3) — bound in production/preview via wrangler.toml
	// (`devpad-hooks`/`devpad-hooks-preview`); absent in bun dev/tests, where
	// the worker falls back to `InMemoryDispatcher` running the consumer
	// synchronously.
	HOOKS_QUEUE?: Queue<HooksQueueMessage>;
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
