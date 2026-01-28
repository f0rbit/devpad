import { AddFilterSchema, CreateProfileSchema, profileId, UpdateProfileSchema, userId } from "@devpad/schema/media";
import { badRequest } from "@devpad/worker/utils/response";
import { Hono } from "hono";
import { z } from "zod";
import { getAuth } from "../auth";
import type { Bindings } from "../bindings";
import { profile } from "../services/profiles";
import { getContext, handleResult, handleResultNoContent, type Variables } from "../utils/route-helpers";

const ProfileTimelineQuerySchema = z.object({
	limit: z.coerce.number().int().min(1).max(500).optional().default(100),
	before: z.string().datetime().optional(),
});

export const profileRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

profileRoutes.get("/", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);

	const result = await profile.list(ctx, userId(auth.user_id));
	return handleResult(c, result);
});

profileRoutes.post("/", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);

	const body = await c.req.json().catch(() => ({}));
	const parseResult = CreateProfileSchema.safeParse(body);

	if (!parseResult.success) {
		return badRequest(c, "Invalid request body", parseResult.error.flatten());
	}

	const result = await profile.create(ctx, userId(auth.user_id), parseResult.data);
	return handleResult(c, result, 201);
});

profileRoutes.get("/:id", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const profId = profileId(c.req.param("id"));

	const result = await profile.get(ctx, userId(auth.user_id), profId);
	return handleResult(c, result);
});

profileRoutes.patch("/:id", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const profId = profileId(c.req.param("id"));

	const body = await c.req.json().catch(() => ({}));
	const parseResult = UpdateProfileSchema.safeParse(body);

	if (!parseResult.success) {
		return badRequest(c, "Invalid request body", parseResult.error.flatten());
	}

	const result = await profile.update(ctx, userId(auth.user_id), profId, parseResult.data);
	return handleResult(c, result);
});

profileRoutes.delete("/:id", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const profId = profileId(c.req.param("id"));

	const result = await profile.delete(ctx, userId(auth.user_id), profId);
	return handleResult(c, result);
});

profileRoutes.get("/:id/filters", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const profId = profileId(c.req.param("id"));

	const result = await profile.filters.list(ctx, userId(auth.user_id), profId);
	return handleResult(c, result);
});

profileRoutes.post("/:id/filters", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const profId = profileId(c.req.param("id"));

	const parseResult = AddFilterSchema.safeParse(await c.req.json());
	if (!parseResult.success) {
		return badRequest(c, "Invalid request body", parseResult.error.flatten());
	}

	const result = await profile.filters.add(ctx, userId(auth.user_id), profId, parseResult.data);
	return handleResult(c, result, 201);
});

profileRoutes.delete("/:id/filters/:filter_id", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const profId = profileId(c.req.param("id"));
	const filterId = c.req.param("filter_id");

	const result = await profile.filters.delete(ctx, userId(auth.user_id), profId, filterId);
	return handleResultNoContent(c, result);
});

profileRoutes.get("/:slug/timeline", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const { slug } = c.req.param();

	const queryResult = ProfileTimelineQuerySchema.safeParse({
		limit: c.req.query("limit"),
		before: c.req.query("before"),
	});

	if (!queryResult.success) {
		return badRequest(c, "Invalid query parameters", queryResult.error.flatten());
	}

	const result = await profile.timeline(ctx, userId(auth.user_id), slug, queryResult.data);
	return handleResult(c, result);
});
