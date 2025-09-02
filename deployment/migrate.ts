import { migrateDb } from "../packages/server/src/server";

// Standalone migration script for deployment
const databaseFile = process.env.DATABASE_FILE || "./data/devpad.db";

const migrationPaths = ["./packages/schema/src/database/drizzle", "../schema/src/database/drizzle", "../../schema/src/database/drizzle"];

console.log("🗄️  Running DevPad database migrations");

migrateDb({ databaseFile, migrationPaths })
	.then(() => {
		console.log("✅ Migration completed successfully");
		process.exit(0);
	})
	.catch(error => {
		console.error("❌ Migration failed:", error);
		process.exit(1);
	});
