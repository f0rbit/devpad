import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type { fullSchema } from "./full-schema.js";

export type Database = BaseSQLiteDatabase<"async", unknown, typeof fullSchema>;
