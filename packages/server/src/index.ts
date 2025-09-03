// Re-export server for backward compatibility

export type { DatabaseOptions, ServerOptions } from "./server";
export { createApp, createServerExport, migrateDb, startServer } from "./server";

// Export database instance from schema package server module
export { db } from "@devpad/schema/database/server";

// Default export for compatibility
import { createServerExport } from "./server";

// Basic server configuration for compatibility
const options = {
	runMigrations: false,
	enableStatic: false,
	corsOrigins: ["http://localhost:4321", "http://localhost:3000"],
	port: Number(process.env.PORT) || 3001,
	environment: process.env.NODE_ENV || "development",
};

export default createServerExport(options);
