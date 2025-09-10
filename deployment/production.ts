import { startServer } from "../packages/server/src/server";

// Production deployment configuration with updated static serving
const options = {
	runMigrations: true, // Auto-migrate on startup
	enableStatic: true, // Serve static files (but with fixed routing)
	staticPath: "./packages/app/dist/client",
	corsOrigins: process.env.CORS_ORIGINS?.split(",") || ["https://devpad.tools", "https://www.devpad.tools", "https://staging.devpad.tools"],
	migrationPaths: ["./packages/schema/src/database/drizzle", "../schema/src/database/drizzle"],
	port: Number(process.env.PORT) || 3000,
	environment: "production",
};

console.log("🚀 Starting DevPad production server");
console.log("📦 Full-stack mode: API + Static files + Database migrations");
console.log("🔧 Fixed: No SPA fallback - proper static file routing");

startServer(options).catch(error => {
	console.error("❌ Failed to start production server:", error);
	process.exit(1);
});
