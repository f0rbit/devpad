import { drizzle } from "drizzle-orm/d1";
import { fullSchema } from "./full-schema.js";
import type { Database } from "./types.js";

export const createD1Database = (d1: D1Database): Database => drizzle(d1, { schema: fullSchema }) as unknown as Database;

export type { Database };
