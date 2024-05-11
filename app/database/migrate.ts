import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";

const sqlite = new Database(import.meta.env.DATABASE_FILE);
const db = drizzle(sqlite);
migrate(db, { migrationsFolder: "./database/drizzle" });
