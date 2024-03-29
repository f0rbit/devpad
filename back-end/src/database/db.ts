import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";

const sqlite = new Database("../database/sqlite.db"); // in database/ in root of github project (outside scope of back-end project)
export const db = drizzle(sqlite);
