import { accountId, PlatformSchema, profileId, userId } from "@devpad/schema/media";
import { Hono } from "hono";
import { z } from "zod";
import { getAuth } from "../auth";
import type { Bindings } from "../bindings";
import { badRequest, notFound, serverError } from "../http-errors";
import type { AppContext } from "../infrastructure/context";
import { connection } from "../services/connections";
import { safeWaitUntil } from "../utils";
import { getContext, handleResult } from "../utils/route-helpers";

type Variables = {
	user: { id: string; github_id: number; name: string; task_view: string } | null;
	mediaContext: AppContext;
};

const CreateConnectionBodySchema = z.object({
	profile_id: z.string().min(1),
	platform: PlatformSchema,
	access_token: z.string().min(1),
	refresh_token: z.string().optional(),
	platform_user_id: z.string().optional(),
	platform_username: z.string().optional(),
	token_expires_at: z.string().optional(),
});

const UpdateConnectionStatusSchema = z.object({
	is_active: z.boolean(),
});

const UpdateSettingsBodySchema = z.object({
	settings: z.record(z.string(), z.unknown()),
});

export const connectionRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

connectionRoutes.get("/", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const includeSettings = c.req.query("include_settings") === "true";
	const profIdParam = c.req.query("profile_id");

	if (!profIdParam) {
		return badRequest(c, "profile_id query parameter required");
	}

	const result = await connection.list(ctx, userId(auth.user_id), profileId(profIdParam), includeSettings);
	return handleResult(c, result);
});

connectionRoutes.post("/", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const parseResult = CreateConnectionBodySchema.safeParse(await c.req.json());

	if (!parseResult.success) {
		return badRequest(c, "Invalid request body", parseResult.error.flatten());
	}

	const result = await connection.create(ctx, userId(auth.user_id), parseResult.data);
	return handleResult(c, result, 201);
});

connectionRoutes.delete("/:account_id", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const accId = accountId(c.req.param("account_id"));

	const { result, backgroundTask } = await connection.delete(ctx, userId(auth.user_id), accId);

	if (backgroundTask) {
		safeWaitUntil(c, backgroundTask, "connection-delete");
	}

	return handleResult(c, result);
});

connectionRoutes.post("/:account_id/refresh", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const accountIdStr = c.req.param("account_id");

	const { result, backgroundTask } = await connection.refresh(ctx, accountIdStr, auth.user_id);

	if (!result.ok) {
		const error = result.error;
		if (error.kind === "not_found") {
			return notFound(c, error.message ?? "Account not found");
		}
		if (error.kind === "bad_request") {
			return badRequest(c, error.message ?? "Bad request");
		}
		return serverError(c, error.message ?? "Server error");
	}

	if (backgroundTask) {
		safeWaitUntil(c, backgroundTask, "refresh");
	}

	return c.json(result.value);
});

connectionRoutes.post("/refresh-all", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);

	const { result, backgroundTasks } = await connection.refreshAll(ctx, auth.user_id);

	if (!result.ok) {
		return serverError(c, "Failed to refresh connections");
	}

	for (const task of backgroundTasks) {
		safeWaitUntil(c, task, "refresh-all");
	}

	return c.json(result.value);
});

connectionRoutes.patch("/:account_id", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const accId = accountId(c.req.param("account_id"));
	const parseResult = UpdateConnectionStatusSchema.safeParse(await c.req.json());

	if (!parseResult.success) {
		return badRequest(c, "Invalid request body", parseResult.error.flatten());
	}

	const result = await connection.status(ctx, userId(auth.user_id), accId, parseResult.data.is_active);
	return handleResult(c, result);
});

connectionRoutes.get("/:account_id/settings", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const accId = accountId(c.req.param("account_id"));

	const result = await connection.settings.get(ctx, userId(auth.user_id), accId);
	return handleResult(c, result);
});

connectionRoutes.put("/:account_id/settings", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const accId = accountId(c.req.param("account_id"));
	const parseResult = UpdateSettingsBodySchema.safeParse(await c.req.json());

	if (!parseResult.success) {
		return badRequest(c, "Invalid request body", parseResult.error.flatten());
	}

	const result = await connection.settings.update(ctx, userId(auth.user_id), accId, parseResult.data.settings);
	return handleResult(c, result);
});

connectionRoutes.get("/:account_id/repos", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const accId = accountId(c.req.param("account_id"));

	const result = await connection.repos(ctx, userId(auth.user_id), accId);
	return handleResult(c, result);
});

connectionRoutes.get("/:account_id/subreddits", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const accId = accountId(c.req.param("account_id"));

	const result = await connection.subreddits(ctx, userId(auth.user_id), accId);
	return handleResult(c, result);
});
