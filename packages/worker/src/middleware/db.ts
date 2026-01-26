import { createD1Database } from "@devpad/schema/database/d1";
import { createMiddleware } from "hono/factory";
import type { AppContext } from "../bindings.js";

export const dbMiddleware = createMiddleware<AppContext>(async (c, next) => {
	const db = createD1Database(c.env.DB);
	c.set("db", db);
	await next();
});
