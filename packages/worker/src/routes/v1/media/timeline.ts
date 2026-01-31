import { timelineService } from "@devpad/core/services/media";
import { Hono } from "hono";
import type { AppContext } from "../../../bindings.js";
import { badRequest, forbidden, handleResult } from "../../../utils/response.js";
import { getAuth, getContext } from "./auth-context.js";

export const timelineRoutes = new Hono<AppContext>();

timelineRoutes.get("/:user_id", async c => {
	const userId = c.req.param("user_id");
	const auth = getAuth(c);
	const ctx = getContext(c);

	if (auth.user_id !== userId) {
		return forbidden(c, "Cannot access other user timelines");
	}

	const from = c.req.query("from");
	const to = c.req.query("to");

	const result = await timelineService.get(ctx, userId, { from, to });
	return handleResult(c, result);
});

timelineRoutes.get("/:user_id/raw/:platform", async c => {
	const userId = c.req.param("user_id");
	const platform = c.req.param("platform");
	const auth = getAuth(c);
	const ctx = getContext(c);

	if (auth.user_id !== userId) {
		return forbidden(c, "Cannot access other user data");
	}

	const accountId = c.req.query("account_id");
	if (!accountId) {
		return badRequest(c, "account_id query parameter required");
	}

	const result = await timelineService.getRaw(ctx, userId, platform, accountId);
	return handleResult(c, result);
});
