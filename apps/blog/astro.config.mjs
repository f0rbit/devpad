import { resolve } from "node:path";
import cloudflare from "@astrojs/cloudflare";
import solidJs from "@astrojs/solid-js";
import { defineConfig } from "astro/config";

export default defineConfig({
	integrations: [solidJs()],
	adapter: cloudflare({
		mode: "advanced",
		imageService: "passthrough",
		platformProxy: {
			enabled: true,
		},
	}),
	output: "server",
	vite: {
		resolve: {
			alias: {
				"@devpad/schema/blog": resolve("../../packages/schema/src/blog/index.ts"),
			},
		},
	},
});
