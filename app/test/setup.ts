import { beforeAll, afterAll } from 'bun:test';
import child_process from 'node:child_process';

let cp: child_process.ChildProcess | null = null;

// start astro server
beforeAll(async () => {
	// call "bun dev" to start the server
	cp = child_process.exec("bun dev");
	await new Promise((resolve) => setTimeout(resolve, 1000));
});

// stop astro server
afterAll(async () => {
	cp?.kill();
	await new Promise((resolve) => setTimeout(resolve, 1000));
});