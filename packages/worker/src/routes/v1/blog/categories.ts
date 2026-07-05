import { createCategoryService } from "@devpad/core/services/blog";
import { CategoryCreateSchema } from "@devpad/schema/blog";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { AppContext } from "../../../bindings.js";
import { response, valid } from "../../../utils/response.js";
import { withAuth } from "./auth.js";

const CategoryNameSchema = z.object({
	name: z.string().min(1),
});

const CategoryUpdateSchema = z.object({
	name: z.string().min(1),
});

export const categoriesRouter = new Hono<AppContext>();

categoriesRouter.get(
	"/",
	withAuth(async (c, user, ctx) => {
		const service = createCategoryService({ db: ctx.db });
		const result = await service.getTree(user.id);
		return response.with(c, result, (categories) => ({ categories }));
	}),
);

categoriesRouter.post(
	"/",
	zValidator("json", CategoryCreateSchema),
	withAuth(async (c, user, ctx) => {
		const data = valid(c, "json") as z.infer<typeof CategoryCreateSchema>;
		const service = createCategoryService({ db: ctx.db });
		const result = await service.create(user.id, data);
		return response.result(c, result, 201);
	}),
);

categoriesRouter.put(
	"/:name",
	zValidator("param", CategoryNameSchema),
	zValidator("json", CategoryUpdateSchema),
	withAuth(async (c, user, ctx) => {
		const { name } = valid(c, "param") as z.infer<typeof CategoryNameSchema>;
		const data = valid(c, "json") as z.infer<typeof CategoryUpdateSchema>;
		const service = createCategoryService({ db: ctx.db });
		const result = await service.update(user.id, name, data);
		return response.result(c, result);
	}),
);

categoriesRouter.delete(
	"/:name",
	zValidator("param", CategoryNameSchema),
	withAuth(async (c, user, ctx) => {
		const { name } = valid(c, "param") as z.infer<typeof CategoryNameSchema>;
		const service = createCategoryService({ db: ctx.db });
		const result = await service.delete(user.id, name);
		return response.empty(c, result);
	}),
);
