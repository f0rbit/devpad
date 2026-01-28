import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { withAuth } from "../middleware/require-auth";
import { createTagService, type TagWithCount } from "../services/tags";
import { errorMap, response, type Variables, valid } from "../utils/route-helpers";

export type { TagWithCount };

const PostUuidSchema = z.object({
	uuid: z.string().uuid(),
});

const TagParamSchema = z.object({
	uuid: z.string().uuid(),
	tag: z.string().min(1),
});

const TagsBodySchema = z.object({
	tags: z.array(z.string().min(1)),
});

export const tagsRouter = new Hono<{ Variables: Variables }>();

tagsRouter.get(
	"/",
	withAuth(async (c, user, ctx) => {
		const service = createTagService({ db: ctx.db });
		const result = await service.list(user.id);
		return response.with(c, result, tags => ({ tags }));
	})
);

tagsRouter.get(
	"/posts/:uuid/tags",
	zValidator("param", PostUuidSchema),
	withAuth(async (c, user, ctx) => {
		const { uuid } = valid<z.infer<typeof PostUuidSchema>>(c, "param");
		const service = createTagService({ db: ctx.db });

		const postResult = await service.findPost(user.id, uuid);
		if (!postResult.ok) {
			const { status, body } = errorMap.response(postResult.error);
			return c.json(body, status);
		}

		const tagsResult = await service.getPostTags(postResult.value.id);
		return response.with(c, tagsResult, tags => ({ tags }));
	})
);

tagsRouter.put(
	"/posts/:uuid/tags",
	zValidator("param", PostUuidSchema),
	zValidator("json", TagsBodySchema),
	withAuth(async (c, user, ctx) => {
		const { uuid } = valid<z.infer<typeof PostUuidSchema>>(c, "param");
		const { tags: newTags } = valid<z.infer<typeof TagsBodySchema>>(c, "json");
		const service = createTagService({ db: ctx.db });

		const postResult = await service.findPost(user.id, uuid);
		if (!postResult.ok) {
			const { status, body } = errorMap.response(postResult.error);
			return c.json(body, status);
		}

		const result = await service.setPostTags(postResult.value.id, newTags);
		return response.with(c, result, tags => ({ tags }));
	})
);

tagsRouter.post(
	"/posts/:uuid/tags",
	zValidator("param", PostUuidSchema),
	zValidator("json", TagsBodySchema),
	withAuth(async (c, user, ctx) => {
		const { uuid } = valid<z.infer<typeof PostUuidSchema>>(c, "param");
		const { tags: tagsToAdd } = valid<z.infer<typeof TagsBodySchema>>(c, "json");
		const service = createTagService({ db: ctx.db });

		const postResult = await service.findPost(user.id, uuid);
		if (!postResult.ok) {
			const { status, body } = errorMap.response(postResult.error);
			return c.json(body, status);
		}

		const result = await service.addPostTags(postResult.value.id, tagsToAdd);
		return response.with(c, result, tags => ({ tags }), 201);
	})
);

tagsRouter.delete(
	"/posts/:uuid/tags/:tag",
	zValidator("param", TagParamSchema),
	withAuth(async (c, user, ctx) => {
		const { uuid, tag } = valid<z.infer<typeof TagParamSchema>>(c, "param");
		const service = createTagService({ db: ctx.db });

		const postResult = await service.findPost(user.id, uuid);
		if (!postResult.ok) {
			const { status, body } = errorMap.response(postResult.error);
			return c.json(body, status);
		}

		const result = await service.removePostTag(postResult.value.id, tag);
		return response.empty(c, result);
	})
);
