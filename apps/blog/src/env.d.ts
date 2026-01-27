/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

type ApiHandler = {
	fetch: (request: Request) => Promise<Response>;
};

type RuntimeEnv = {
	API_HANDLER?: ApiHandler;
	ASSETS: { fetch: (req: Request | string) => Promise<Response> };
	DB: D1Database;
	CORPUS_BUCKET: R2Bucket;
	ENVIRONMENT: string;
	DEVPAD_API: string;
	[key: string]: unknown;
};

declare namespace App {
	interface Locals {
		runtime: {
			env: RuntimeEnv;
			cf: CfProperties;
			ctx: ExecutionContext;
			caches: CacheStorage;
		};
	}
}
