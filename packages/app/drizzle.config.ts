import { defineConfig } from "drizzle-kit";

export default defineConfig({
	driver: "libsql",
	out: "./database/drizzle",
	schema: "./database/schema.ts",
	// dialect: "sqlite",
	dbCredentials: {
		url: `file:` + Bun.env.DATABASE_FILE!,
	},
});
