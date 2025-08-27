import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Database } from 'bun:sqlite';
import * as schema from '@/database/schema';

const dbPath = process.env.DATABASE_URL?.replace('sqlite://', '') || '../test.db';

try {
  console.log('🌳 Database path:', dbPath);
  
  const sqlite = new Database(dbPath);
  const db = drizzle(sqlite, { schema });

  console.log('🌳 Running migrations...');
  migrate(db, { migrationsFolder: './database/drizzle' });
  console.log('✅ Migrations complete');

  // Optional: Check tables
  const tables = sqlite.query("SELECT name FROM sqlite_master WHERE type='table';").all();
  console.log('📋 Existing tables:', tables);
} catch (error) {
  console.error('❌ Migration failed:', error);
  process.exit(1);
}