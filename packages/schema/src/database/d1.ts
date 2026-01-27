import { drizzle } from "drizzle-orm/d1";
import * as blogSchema from "./blog.js";
import * as mediaSchema from "./media.js";
import * as devpadSchema from "./schema.js";

// biome-ignore lint/suspicious/noExplicitAny: mixed drizzle-orm versions between corpus and devpad make the unified schema type unnameable
export const createD1Database = (d1: D1Database): ReturnType<typeof drizzle<any>> =>
	drizzle(d1, {
		schema: { ...devpadSchema, ...blogSchema, ...mediaSchema } as any,
	});

export type UnifiedDatabase = ReturnType<typeof createD1Database>;
