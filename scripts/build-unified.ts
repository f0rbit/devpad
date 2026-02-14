import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";

const ROOT_DIR = process.cwd();
const DIST_DIR = join(ROOT_DIR, "dist");

const APPS = {
	devpad: { dir: join(ROOT_DIR, "apps/main"), filter: "@devpad/app" },
	blog: { dir: join(ROOT_DIR, "apps/blog"), filter: "@devpad/blog-app" },
	media: { dir: join(ROOT_DIR, "apps/media"), filter: "@devpad/media-app" },
} as const;

type AppName = keyof typeof APPS;
const APP_NAMES = Object.keys(APPS) as AppName[];

const workerDir = (name: AppName) => `_${name}-worker`;

const readRoutesJson = (app_dist: string) => {
	const routes_path = join(app_dist, "_routes.json");
	if (!existsSync(routes_path)) return null;
	return JSON.parse(readFileSync(routes_path, "utf-8"));
};

const mergeRoutesJson = (app_dists: Record<AppName, string>) => {
	const all_includes: string[] = [];
	const all_excludes: string[] = [];

	for (const name of APP_NAMES) {
		const routes = readRoutesJson(app_dists[name]);
		if (!routes) continue;
		if (routes.include) all_includes.push(...routes.include);
		if (routes.exclude) all_excludes.push(...routes.exclude);
	}

	return {
		version: 1,
		include: [...new Set(["/*", ...all_includes])],
		exclude: [...new Set(all_excludes)],
	};
};

const generateWorkerEntry = () =>
	`
import { createUnifiedWorker } from "./api/index.js";
import devpadAstro from "./${workerDir("devpad")}/index.js";
import blogAstro from "./${workerDir("blog")}/index.js";
import mediaAstro from "./${workerDir("media")}/index.js";

const worker = createUnifiedWorker({
  devpad: { fetch: devpadAstro.fetch },
  blog: { fetch: blogAstro.fetch },
  media: { fetch: mediaAstro.fetch },
});

export default {
  fetch: worker.fetch,
  scheduled: worker.scheduled,
};
`.trim();

const generateAssetsIgnore = () => ["_worker.js", ...APP_NAMES.map(workerDir), "api", "_routes.json"].join("\n") + "\n";

async function build() {
	console.log("Building unified worker...\n");

	if (existsSync(DIST_DIR)) {
		console.log("Cleaning dist directory...");
		rmSync(DIST_DIR, { recursive: true });
	}
	mkdirSync(DIST_DIR, { recursive: true });

	console.log("Building all Astro apps in parallel...");
	await Promise.all(APP_NAMES.map(name => $`bun run --filter '${APPS[name].filter}' build`));

	const app_dists = Object.fromEntries(APP_NAMES.map(name => [name, join(APPS[name].dir, "dist")])) as Record<AppName, string>;

	console.log("Copying client assets...");
	mkdirSync(join(DIST_DIR, "_astro"), { recursive: true });
	for (const name of APP_NAMES) {
		const astro_dir = join(app_dists[name], "_astro");
		if (existsSync(astro_dir)) {
			cpSync(astro_dir, join(DIST_DIR, "_astro"), { recursive: true });
		}
	}

	console.log("Copying Astro workers...");
	for (const name of APP_NAMES) {
		const src = join(app_dists[name], "_worker.js");
		const dest = join(DIST_DIR, workerDir(name));
		if (existsSync(src)) {
			cpSync(src, dest, { recursive: true });
		}
	}

	console.log("Bundling worker API...");
	await $`bun build packages/worker/src/index.ts --outdir dist/api --target browser --format esm`;

	console.log("Generating unified worker entry...");
	writeFileSync(join(DIST_DIR, "_worker.js"), generateWorkerEntry());

	console.log("Merging routes...");
	const merged_routes = mergeRoutesJson(app_dists);
	writeFileSync(join(DIST_DIR, "_routes.json"), JSON.stringify(merged_routes, null, 2));

	console.log("Generating .assetsignore...");
	writeFileSync(join(DIST_DIR, ".assetsignore"), generateAssetsIgnore());

	console.log("\nBuild complete!");
	console.log("   Worker entry:  dist/_worker.js");
	console.log("   API code:      dist/api/");
	for (const name of APP_NAMES) {
		console.log(`   ${name} worker: dist/${workerDir(name)}/`);
	}
	console.log("   Client assets: dist/_astro/");
	console.log("\nDeploy with: bunx wrangler deploy");
}

build().catch(error => {
	console.error("Build failed:", error);
	process.exit(1);
});
