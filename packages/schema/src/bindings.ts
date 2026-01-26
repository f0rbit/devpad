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
};
