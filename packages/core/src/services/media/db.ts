import * as schema from "@devpad/schema/database/media";
import { drizzle } from "drizzle-orm/d1";

export function createDb(d1: D1Database) {
	return drizzle(d1, { schema });
}

export type Database = ReturnType<typeof createDb>;
