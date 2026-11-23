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

/**
 * bun:sqlite runs with FOREIGN_KEYS off by default — D1 never does. Enforce
 * it on every connection we wrap so test/dev databases behave like
 * production: any insert violating a `.references()` FK fails here instead
 * of silently succeeding and failing only on D1.
 */
export const createBunDatabase = (sqlite: BunSqliteDatabase): Database => {
	sqlite.run("PRAGMA foreign_keys = ON");
	return drizzle(sqlite, { schema: fullSchema }) as unknown as Database;
};

export const migrateBunDatabase = (sqlite: BunSqliteDatabase, migrations_folder: string = BUN_MIGRATIONS_DIR): void => {
	// Replay with FKs off (some hand-written rebuild migrations + seed
	// backfills were authored against the relaxed mode), then re-enable so
	// everything after the migrate call is FK-enforced regardless of call
	// order relative to `createBunDatabase`.
	sqlite.run("PRAGMA foreign_keys = OFF");
	const db = drizzle(sqlite);
	migrate(db, { migrationsFolder: migrations_folder });
	sqlite.run("PRAGMA foreign_keys = ON");
};
