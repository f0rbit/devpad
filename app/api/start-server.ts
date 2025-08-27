import { Elysia } from 'elysia';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Database } from 'bun:sqlite';
import { v0Routes } from './src/routes';
import * as schema from '../database/schema';

const port = process.env.PORT || 8080;
const dbPath = process.env.DATABASE_URL?.replace('sqlite://', '') || './test.db';

console.log('🌳 Database path:', dbPath);

try {
  // Create SQLite database and run migrations
  const sqlite = new Database(dbPath);
  const db = drizzle(sqlite, { schema });

  console.log('🌳 Running migrations...');
  migrate(db, { migrationsFolder: '../database/drizzle' });
  console.log('✅ Migrations complete');

  // Create Elysia server
  const app = new Elysia()
    .use(v0Routes)
    .listen(port);

  console.log(`🚀 Server running on port ${port}`);
} catch (error) {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
}