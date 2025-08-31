import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";

const sqlite = new Database(Bun.env.DATABASE_FILE);
const db = drizzle(sqlite);
migrate(db, { migrationsFolder: "./src/database/drizzle" });
