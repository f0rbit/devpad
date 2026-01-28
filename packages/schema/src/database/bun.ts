import type { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as blogSchema from "./blog.js";
import type { UnifiedDatabase } from "./d1.js";
import * as mediaSchema from "./media.js";
import * as devpadSchema from "./schema.js";

export const createBunDatabase = (sqlite: Database): UnifiedDatabase =>
	drizzle(sqlite, {
		schema: { ...devpadSchema, ...blogSchema, ...mediaSchema } as any,
	}) as unknown as UnifiedDatabase;

export const migrateBunDatabase = (sqlite: Database, migrations_folder: string): void => {
	const db = drizzle(sqlite);
	migrate(db, { migrationsFolder: migrations_folder });
};
