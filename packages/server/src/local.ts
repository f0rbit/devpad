import { startServer } from "./server";

// Local development configuration
const options = {
	runMigrations: false, // Don't auto-migrate in dev (use separate command)
	enableStatic: false, // Astro dev server handles static files
	corsOrigins: [
		"http://localhost:4321", // Astro dev server
		"http://localhost:3000", // Alternative dev port
		"http://localhost:5173", // Vite dev server
	],
	port: Number(process.env.PORT) || 3001, // Different port to avoid conflicts
	environment: "development",
};

console.log("🛠️  Starting DevPad API server for local development");
console.log("📝 Note: Run Astro dev server separately for frontend");

startServer(options).catch(error => {
	console.error("❌ Failed to start local server:", error);
	process.exit(1);
});
