import { defineConfig } from 'astro/config';
import node from "@astrojs/node";

import solidJs from "@astrojs/solid-js";

console.log(Bun.env.PORT);

// https://astro.build/config
export default defineConfig({
  server: { port: Bun.env.PORT ? Number(Bun.env.PORT) : 3000 },
  site: "https://devpad.tools",
  output: "server",
  adapter: node({
    mode: "middleware"
  }),
  integrations: [solidJs()],
  experimental: {
    session: { driver: "fs" },
  }
});
