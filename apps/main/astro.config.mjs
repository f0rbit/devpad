import sitemap from "@astrojs/sitemap";
import solidJs from "@astrojs/solid-js";
import { defineConfig } from "astro/config";
import honoAstro from "hono-astro-adapter";

const site = process.env.SITE_URL ?? "https://devpad.tools";

// https://astro.build/config
export default defineConfig({
	server: { port: process.env.PORT ? Number(process.env.PORT) : 3000 },
	site,
	output: "server",
	adapter: honoAstro(),
	integrations: [
		solidJs(),
		sitemap({
			customPages: [`${site}/`, `${site}/docs/`],
		}),
	],
	session: {
		driver: "fs",
	},
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
