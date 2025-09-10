import { startServer } from "../packages/server/src/server";

// Production deployment configuration with full features
const options = {
	runMigrations: true, // Auto-migrate on startup
	enableStatic: true, // Serve Astro static files
	staticPath: "./packages/app/dist/client",
	corsOrigins: process.env.CORS_ORIGINS?.split(",") || ["https://devpad.tools", "https://www.devpad.tools"],
	migrationPaths: ["./packages/schema/src/database/drizzle", "../schema/src/database/drizzle"],
	port: Number(process.env.PORT) || 3000,
	environment: "production",
};

console.log("🚀 Starting DevPad production server");
console.log("📦 Full-stack mode: API + Static files + Database migrations");

startServer(options).catch(error => {
	console.error("❌ Failed to start production server:", error);
	process.exit(1);
});
