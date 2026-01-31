import { defineConfig } from "drizzle-kit";

export default defineConfig({
	schema: ["./src/database/schema.ts", "./src/database/blog.ts", "./src/database/media.ts"],
	out: "./src/database/drizzle",
	dialect: "sqlite",
});
