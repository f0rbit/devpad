import { createContext as createBlogContext } from "@devpad/core/services/blog";
import { createMediaContext, createProviderFactory } from "@devpad/core/services/media";
import { create_cloudflare_backend } from "@devpad/schema/blog";
import { createD1Database } from "@devpad/schema/database/d1";
import { create_cloudflare_backend as create_media_backend } from "@f0rbit/corpus/cloudflare";
import { createMiddleware } from "hono/factory";
import type { AppContext } from "../bindings.js";

export const unifiedContextMiddleware = createMiddleware<AppContext>(async (c, next) => {
	const env = c.env;

	if (!env.DB || !env.BLOG_CORPUS_BUCKET || !env.MEDIA_CORPUS_BUCKET) {
		return next();
	}

	const db = createD1Database(env.DB);

	const blog_backend = create_cloudflare_backend({ d1: env.DB, r2: env.BLOG_CORPUS_BUCKET });
	const blog_context = createBlogContext({
		db,
		backend: blog_backend,
		jwt_secret: env.JWT_SECRET,
		environment: env.ENVIRONMENT,
	});
	c.set("blogContext", blog_context);

	const media_backend = create_media_backend({ d1: env.DB, r2: env.MEDIA_CORPUS_BUCKET });
	const media_context = createMediaContext({
		db,
		backend: media_backend,
		providerFactory: createProviderFactory(db),
		encryptionKey: env.ENCRYPTION_KEY,
		env: {
			REDDIT_CLIENT_ID: env.REDDIT_CLIENT_ID,
			REDDIT_CLIENT_SECRET: env.REDDIT_CLIENT_SECRET,
			TWITTER_CLIENT_ID: env.TWITTER_CLIENT_ID,
			TWITTER_CLIENT_SECRET: env.TWITTER_CLIENT_SECRET,
			GITHUB_CLIENT_ID: env.GITHUB_CLIENT_ID,
			GITHUB_CLIENT_SECRET: env.GITHUB_CLIENT_SECRET,
		},
	});
	c.set("mediaContext", media_context);

	return next();
});
