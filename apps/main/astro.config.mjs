import cloudflare from "@astrojs/cloudflare";
import sitemap from "@astrojs/sitemap";
import solidJs from "@astrojs/solid-js";
import { defineConfig } from "astro/config";

const site = process.env.SITE_URL ?? "https://devpad.tools";

export default defineConfig({
	server: { port: process.env.PORT ? Number(process.env.PORT) : 3000 },
	site,
	output: "server",
	adapter: cloudflare({
		mode: "advanced",
		imageService: "passthrough",
		platformProxy: {
			enabled: true,
		},
	}),
	integrations: [
		solidJs(),
		sitemap({
			customPages: [`${site}/`, `${site}/docs/`],
		}),
	],
	vite: {
		server: {
			proxy: {
				"/api": {
					target: "http://localhost:3001",
					changeOrigin: true,
				},
				"/health": {
					target: "http://localhost:3001",
					changeOrigin: true,
				},
			},
		},
		build: {
			watch: false,
			chunkSizeWarningLimit: 3000,
			sourcemap: false,
		},
		resolve: {
			alias: {
				"@": "/src",
			},
		},
	},
});
