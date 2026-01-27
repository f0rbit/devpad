import { createContextFromDeps } from "@devpad/blog-server/context";
import { createContextFromBindings, createProviderFactory } from "@devpad/media-server";
import { createMiddleware } from "hono/factory";
import type { AppContext } from "../bindings.js";

export const unifiedContextMiddleware = createMiddleware<AppContext>(async (c, next) => {
	const env = c.env;

	const blog_context = createContextFromDeps({
		blog_db: env.DB,
		blog_bucket: env.BLOG_CORPUS_BUCKET,
		jwt_secret: env.JWT_SECRET,
		environment: env.ENVIRONMENT,
	});
	c.set("blogContext", blog_context);

	const provider_factory = createProviderFactory(env.DB);
	const media_context = createContextFromBindings(env, provider_factory);
	c.set("mediaContext", media_context);

	return next();
});
