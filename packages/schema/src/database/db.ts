import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import * as schema from "./schema";

const sqlite = new Database(Bun.env.DATABASE_FILE!); // in database/ in root of github project (outside scope of back-end project)
export const db = drizzle(sqlite, { schema });
