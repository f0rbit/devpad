import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema.js";

const sqlite = new Database(Bun.env.DATABASE_FILE!);
export const db = drizzle(sqlite, { schema });
