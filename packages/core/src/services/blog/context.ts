import { create_cloudflare_backend, create_corpus, type DrizzleDB, type PostsCorpus, postsStoreDefinition } from "@devpad/schema/blog";
import { drizzle } from "drizzle-orm/d1";

export type AppContext = {
	db: DrizzleDB;
	corpus: PostsCorpus;
	jwt_secret: string;
	environment: string;
};

type ContextDeps = {
	blog_db: D1Database;
	blog_bucket: R2Bucket;
	jwt_secret: string;
	environment: string;
};

export const createContextFromDeps = (deps: ContextDeps): AppContext => {
	const backend = create_cloudflare_backend({
		d1: deps.blog_db,
		r2: deps.blog_bucket as unknown as Parameters<typeof create_cloudflare_backend>[0]["r2"],
	});

	const corpus = create_corpus().with_backend(backend).with_store(postsStoreDefinition).build();

	return {
		db: drizzle(deps.blog_db) as DrizzleDB,
		corpus,
		jwt_secret: deps.jwt_secret,
		environment: deps.environment,
	};
};
