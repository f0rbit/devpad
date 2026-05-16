import type { Database as BunSqliteDatabase } from "bun:sqlite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { fullSchema } from "./full-schema.js";
import type { Database } from "./types.js";

/**
 * Absolute path to the drizzle migrations directory shipped alongside
 * `@devpad/schema`. Anchored to this module's own URL so it resolves
 * correctly whether the package is consumed from source (path-alias /
 * workspace) or from the built `dist/` (the `build` script copies the
 * `drizzle/` folder next to the compiled `bun.js`). Use this from test
 * harnesses instead of hand-rolled relative `../../../../` paths.
 */
export const BUN_MIGRATIONS_DIR: string = resolve(dirname(fileURLToPath(import.meta.url)), "drizzle");

export const createBunDatabase = (sqlite: BunSqliteDatabase): Database => drizzle(sqlite, { schema: fullSchema }) as unknown as Database;

export const migrateBunDatabase = (sqlite: BunSqliteDatabase, migrations_folder: string = BUN_MIGRATIONS_DIR): void => {
	const db = drizzle(sqlite);
	migrate(db, { migrationsFolder: migrations_folder });
};
