import node from "@astrojs/node";
import sitemap from "@astrojs/sitemap";
import solidJs from "@astrojs/solid-js";
import { defineConfig } from "astro/config";

const site = "https://devpad.tools";

// https://astro.build/config
export default defineConfig({
	server: { port: Bun.env.PORT ? Number(Bun.env.PORT) : 3000 },
	site: "https://devpad.tools",
	output: "server",
	adapter: node({
		mode: "standalone",
	}),
	integrations: [
		solidJs(),
		sitemap({
			customPages: [`${site}/`, `${site}/docs/`],
		}),
	],
	experimental: {
		session: { driver: "fs" },
	},
	vite: {
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
