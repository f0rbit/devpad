import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "@devpad/schema/database/schema";

const sqlite = new Database(Bun.env.DATABASE_FILE!); // in database/ in root of github project (outside scope of back-end project)
export const db = drizzle(sqlite, { schema });
