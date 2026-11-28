import { createD1Database } from "@devpad/schema/database/d1";
import { createMiddleware } from "hono/factory";
import type { AppContext } from "../bindings.js";

export const dbMiddleware = createMiddleware<AppContext>(async (c, next) => {
	// Bindings.DB is optional in the Bindings type (bun dev/tests inject the db
	// via ApiOptions and never reach this middleware) — fail closed rather
	// than handing routes a lying `Database`.
	if (c.req.path === "/health") return next();
	if (!c.env.DB) return c.json({ error: "Database not configured" }, 503);
	c.set("db", createD1Database(c.env.DB));
	await next();
});
