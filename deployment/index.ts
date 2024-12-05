import express from "express";
import { handler as ssrHandler } from '../app/dist/server/entry.mjs';
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";

console.log("🌳 database file:", Bun.env.DATABASE_FILE);

const sqlite = new Database(Bun.env.DATABASE_FILE);
const db = drizzle(sqlite);
console.log("⌛️ running migrations");
migrate(db, { migrationsFolder: "../app/database/drizzle"});
console.log("✅ migrations complete");

const app = express();

const base = '/';
app.use(base, express.static('../app/dist/client/'));
app.use(ssrHandler);

console.log("✅ started server on port:", process.env.PORT);
app.listen(process.env.PORT);