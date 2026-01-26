import { drizzle } from "drizzle-orm/d1";
import * as blogSchema from "./blog.js";
import * as mediaSchema from "./media.js";
import * as devpadSchema from "./schema.js";

export const createD1Database = (d1: D1Database) =>
	drizzle(d1, {
		schema: { ...devpadSchema, ...blogSchema, ...mediaSchema },
	});

export type UnifiedDatabase = ReturnType<typeof createD1Database>;
