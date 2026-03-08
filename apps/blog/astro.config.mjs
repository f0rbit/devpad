import { resolve } from "node:path";
import cloudflare from "@astrojs/cloudflare";
import sitemap from "@astrojs/sitemap";
import solidJs from "@astrojs/solid-js";
import { defineConfig } from "astro/config";

const site = process.env.SITE_URL ?? "https://blog.devpad.tools";

export default defineConfig({
	server: { port: 3002 },
	site,
	integrations: [
		solidJs(),
		sitemap({
			customPages: [`${site}/`],
		}),
	],
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
				"@devpad/schema/blog": resolve("../../packages/schema/src/blog/index.ts"),
			},
		},
	},
});
