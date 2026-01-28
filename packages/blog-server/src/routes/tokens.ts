import { AccessKeyCreateSchema, AccessKeyUpdateSchema } from "@devpad/schema/blog";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { withAuth } from "../middleware/require-auth";
import { type CreatedToken, createTokenService, type SanitizedToken } from "../services/tokens";
import { response, type Variables, valid } from "../utils/route-helpers";

export type { CreatedToken, SanitizedToken };

const TokenIdSchema = z.object({
	id: z.string().min(1),
});

export const tokensRouter = new Hono<{ Variables: Variables }>();

tokensRouter.get(
	"/",
	withAuth(async (c, user, ctx) => {
		const service = createTokenService({ db: ctx.db });
		const result = await service.list(user.id);
		return response.with(c, result, tokens => ({ tokens }));
	})
);

tokensRouter.post(
	"/",
	zValidator("json", AccessKeyCreateSchema),
	withAuth(async (c, user, ctx) => {
		const data = valid<z.infer<typeof AccessKeyCreateSchema>>(c, "json");
		const service = createTokenService({ db: ctx.db });
		const result = await service.create(user.id, data);
		return response.result(c, result, 201);
	})
);

tokensRouter.put(
	"/:id",
	zValidator("param", TokenIdSchema),
	zValidator("json", AccessKeyUpdateSchema),
	withAuth(async (c, user, ctx) => {
		const { id } = valid<z.infer<typeof TokenIdSchema>>(c, "param");
		const data = valid<z.infer<typeof AccessKeyUpdateSchema>>(c, "json");
		const service = createTokenService({ db: ctx.db });
		const result = await service.update(user.id, id, data);
		return response.result(c, result);
	})
);

tokensRouter.delete(
	"/:id",
	zValidator("param", TokenIdSchema),
	withAuth(async (c, user, ctx) => {
		const { id } = valid<z.infer<typeof TokenIdSchema>>(c, "param");
		const service = createTokenService({ db: ctx.db });
		const result = await service.delete(user.id, id);
		return response.empty(c, result);
	})
);
