import { createPostService } from "@devpad/core/services/blog";
import { PostCreateSchema, PostListParamsSchema, PostUpdateSchema } from "@devpad/schema/blog";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { AppContext } from "../../../bindings.js";
import { response, valid } from "../../../utils/response.js";
import { withAuth } from "./auth.js";

export const postsRouter = new Hono<AppContext>();

const UuidParamSchema = z.object({
	uuid: z.string().uuid(),
});

const SlugParamSchema = z.object({
	slug: z.string().min(1),
});

const HashParamSchema = z.object({
	hash: z.string().min(1),
});

const UuidHashParamSchema = UuidParamSchema.merge(HashParamSchema);

postsRouter.get(
	"/",
	zValidator("query", PostListParamsSchema),
	withAuth(async (c, user, ctx) => {
		const params = valid(c, "query") as z.infer<typeof PostListParamsSchema>;
		const service = createPostService({ db: ctx.db, corpus: ctx.corpus });
		const result = await service.list(user.id, params);
		return response.result(c, result);
	}),
);

postsRouter.get(
	"/:slug",
	zValidator("param", SlugParamSchema),
	withAuth(async (c, user, ctx) => {
		const { slug } = valid(c, "param") as z.infer<typeof SlugParamSchema>;
		const service = createPostService({ db: ctx.db, corpus: ctx.corpus });
		const result = await service.getBySlug(user.id, slug);
		return response.result(c, result);
	}),
);

postsRouter.post(
	"/",
	zValidator("json", PostCreateSchema),
	withAuth(async (c, user, ctx) => {
		const input = valid(c, "json") as z.infer<typeof PostCreateSchema>;
		const service = createPostService({ db: ctx.db, corpus: ctx.corpus });
		const result = await service.create(user.id, input);
		return response.result(c, result, 201);
	}),
);

postsRouter.put(
	"/:uuid",
	zValidator("param", UuidParamSchema),
	zValidator("json", PostUpdateSchema),
	withAuth(async (c, user, ctx) => {
		const { uuid } = valid(c, "param") as z.infer<typeof UuidParamSchema>;
		const input = valid(c, "json") as z.infer<typeof PostUpdateSchema>;
		const service = createPostService({ db: ctx.db, corpus: ctx.corpus });
		const result = await service.update(user.id, uuid, input);
		return response.result(c, result);
	}),
);

postsRouter.delete(
	"/:uuid",
	zValidator("param", UuidParamSchema),
	withAuth(async (c, user, ctx) => {
		const { uuid } = valid(c, "param") as z.infer<typeof UuidParamSchema>;
		const service = createPostService({ db: ctx.db, corpus: ctx.corpus });
		const result = await service.delete(user.id, uuid);
		return response.with(c, result, () => ({ success: true }));
	}),
);

postsRouter.get(
	"/:uuid/versions",
	zValidator("param", UuidParamSchema),
	withAuth(async (c, user, ctx) => {
		const { uuid } = valid(c, "param") as z.infer<typeof UuidParamSchema>;
		const service = createPostService({ db: ctx.db, corpus: ctx.corpus });
		const result = await service.listVersions(user.id, uuid);
		return response.with(c, result, (versions) => ({ versions }));
	}),
);

postsRouter.get(
	"/:uuid/version/:hash",
	zValidator("param", UuidHashParamSchema),
	withAuth(async (c, user, ctx) => {
		const { uuid, hash } = valid(c, "param") as z.infer<typeof UuidHashParamSchema>;
		const service = createPostService({ db: ctx.db, corpus: ctx.corpus });
		const result = await service.getVersion(user.id, uuid, hash);
		return response.result(c, result);
	}),
);

postsRouter.post(
	"/:uuid/restore/:hash",
	zValidator("param", UuidHashParamSchema),
	withAuth(async (c, user, ctx) => {
		const { uuid, hash } = valid(c, "param") as z.infer<typeof UuidHashParamSchema>;
		const service = createPostService({ db: ctx.db, corpus: ctx.corpus });
		const result = await service.restoreVersion(user.id, uuid, hash);
		return response.result(c, result);
	}),
);
