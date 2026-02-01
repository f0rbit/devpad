import type { Database as BunSqliteDatabase } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { fullSchema } from "./full-schema.js";
import type { Database } from "./types.js";

export const createBunDatabase = (sqlite: BunSqliteDatabase): Database => drizzle(sqlite, { schema: fullSchema }) as unknown as Database;

export const migrateBunDatabase = (sqlite: BunSqliteDatabase, migrations_folder: string): void => {
	const db = drizzle(sqlite);
	migrate(db, { migrationsFolder: migrations_folder });
};
