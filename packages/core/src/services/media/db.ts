import type * as schema from "@devpad/schema/database/media";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";

export type Database = BaseSQLiteDatabase<"async", unknown, typeof schema>;
