import { defineConfig } from 'astro/config';
import node from "@astrojs/node";
import sitemap from "@astrojs/sitemap";

import solidJs from "@astrojs/solid-js";

const site = "https://devpad.tools";


// https://astro.build/config
export default defineConfig({
  server: { port: Bun.env.PORT ? Number(Bun.env.PORT) : 3000 },
  site: "https://devpad.tools",
  output: "server",
  adapter: node({
    mode: "middleware"
  }),
  integrations: [solidJs(), sitemap({
    customPages: [`${site}/`, `${site}/docs/`],
  })],
  experimental: {
    session: { driver: "fs" },
  },
  vite: {
    build: {
      watch: false,
      chunkSizeWarningLimit: 3000,
      sourcemap: false
    },
  }
});
