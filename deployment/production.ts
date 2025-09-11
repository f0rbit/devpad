import { startServer } from "../packages/server/src/server";

const options = {
	runMigrations: true, // Auto-migrate on startup
	staticPath: "./packages/app/dist/client",
	corsOrigins: process.env.CORS_ORIGINS?.split(",") || ["https://devpad.tools", "https://www.devpad.tools", "https://staging.devpad.tools"],
	migrationPaths: ["./packages/schema/src/database/drizzle", "../schema/src/database/drizzle"],
	port: Number(process.env.PORT) || 3000,
	environment: "production",
};

console.log("🚀 Starting DevPad production server");
console.log("📦 Full-stack mode: API + Astro SSR + Database migrations");

startServer(options).catch(error => {
	console.error("❌ Failed to start production server:", error);
	process.exit(1);
});
