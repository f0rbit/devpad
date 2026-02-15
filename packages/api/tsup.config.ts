import { defineConfig } from "tsup";

export default defineConfig({
	entry: {
		index: "src/index.ts",
		"schema/index": "src/schema/index.ts",
		"schema/blog": "src/schema/blog.ts",
		"schema/media": "src/schema/media.ts",
	},
	format: ["esm"],
	dts: true,
	splitting: true,
	clean: true,
	outDir: "dist",
	external: ["@f0rbit/corpus", "zod", "drizzle-orm", "drizzle-orm/sqlite-core", "drizzle-zod"],
	noExternal: ["@devpad/schema"],
});
