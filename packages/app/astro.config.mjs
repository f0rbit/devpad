import sitemap from "@astrojs/sitemap";
import solidJs from "@astrojs/solid-js";
import { defineConfig } from "astro/config";
import honoAstro from "hono-astro-adapter";

const site = Bun.env.SITE_URL ?? "https://devpad.tools";

// https://astro.build/config
export default defineConfig({
	server: { port: Bun.env.PORT ? Number(Bun.env.PORT) : 3000 },
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
