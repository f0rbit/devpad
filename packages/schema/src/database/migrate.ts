import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

const sqlite = new Database(Bun.env.DATABASE_FILE);
const db = drizzle(sqlite);
migrate(db, { migrationsFolder: "./src/database/drizzle" });
