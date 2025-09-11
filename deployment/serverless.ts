import { createServerExport } from "../packages/server/src/server";

// Serverless deployment configuration (API-only)
const options = {
	runMigrations: false, // Migrations handled separately in serverless
	corsOrigins: process.env.CORS_ORIGINS?.split(",") || ["https://devpad.tools", "https://www.devpad.tools", "https://app.devpad.tools"],
	port: Number(process.env.PORT) || 3000,
	environment: "serverless",
};

console.log("⚡ DevPad serverless API server configured");
console.log("🔧 API-only mode: Static files served by CDN");

// Export for serverless platforms (Vercel, Netlify, etc.)
export default createServerExport(options);
