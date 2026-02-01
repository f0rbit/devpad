import { resolve } from "node:path";
import cloudflare from "@astrojs/cloudflare";
import solidJs from "@astrojs/solid-js";
import { defineConfig } from "astro/config";

export default defineConfig({
	server: { port: 3003 },
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
		server: {
			proxy: {
				"/api": "http://localhost:3001",
				"/health": "http://localhost:3001",
			},
		},
		resolve: {
			alias: {
				"@": resolve("./src"),
				"@devpad/schema/media": resolve("../../packages/schema/src/media/index.ts"),
			},
		},
	},
});
