import { Hono } from "hono";
import type { Variables } from "../utils/route-helpers";

export const healthRouter = new Hono<{ Variables: Variables }>();

healthRouter.get("/", c => {
	const ctx = c.get("blogContext");
	return c.json({
		status: "ok",
		timestamp: new Date().toISOString(),
		environment: ctx?.environment ?? "unknown",
	});
});
