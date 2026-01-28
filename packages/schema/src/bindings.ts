export type AuthUser = {
	id: string;
	github_id: number;
	name: string;
	task_view: "list" | "grid";
} | null;

export type Bindings = {
	DB: D1Database;
	BLOG_CORPUS_BUCKET: R2Bucket;
	MEDIA_CORPUS_BUCKET: R2Bucket;
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
};
