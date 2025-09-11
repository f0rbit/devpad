import { startServer } from "./server";
import { log } from "@devpad/core";

// Local development configuration
const options = {
	runMigrations: true, // Always run migrations in local development
	corsOrigins: [
		"http://localhost:4321", // Astro dev server
		"http://localhost:3000", // Alternative dev port
		"http://localhost:5173", // Vite dev server
	],
	port: Number(process.env.PORT) || 3001, // Different port to avoid conflicts
	environment: "development",
};

log.startup("🛠️  Starting DevPad API server for local development");
console.log("📝 Note: Run Astro dev server separately for frontend");

startServer(options).catch(error => {
	console.error("❌ Failed to start local server:", error);
	process.exit(1);
});
