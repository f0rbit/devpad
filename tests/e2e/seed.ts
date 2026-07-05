import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { E2E_PROJECT_ID, open_test_db, seed_pipeline_fixtures } from "./fixtures/pipelines";

/**
 * Standalone bun seed entrypoint — seeds the pipelines E2E fixture into the
 * repo-root `database/test.db` BEFORE Playwright boots its webServers.
 *
 * It runs as a pre-test step (`bun run tests/e2e/seed.ts && playwright test`),
 * NOT via Playwright's `globalSetup`: the fixture imports `bun:sqlite`, and the
 * `playwright` bin is node-shebang, so a node-side `globalSetup` cannot load it
 * (`Received protocol 'bun:'`). Keeping the seed on the same bun:sqlite stack the
 * worker/app use is the single-source-of-truth choice; we just run it under bun.
 *
 * Resolves the DB path relative to this file (repo-root `database/test.db`),
 * matching the file the local worker webServer opens
 * (`DATABASE_FILE=../../database/test.db` from packages/worker).
 *
 * `migrateBunDatabase` creates + migrates the file if absent, and the seed is
 * idempotent (delete-then-insert on fixed ids), so this is safe to run
 * repeatedly. The SQLite handle is closed before the process exits, so when
 * Playwright later boots the worker, the worker is the only long-lived writer.
 */
export async function seed(): Promise<void> {
	const repo_root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
	const db_file = resolve(repo_root, "database", "test.db");

	const { sqlite, db } = open_test_db(db_file);
	try {
		await seed_pipeline_fixtures(db);
		console.log(`[e2e seed] seeded pipelines fixtures into ${db_file} (project=${E2E_PROJECT_ID})`);
	} finally {
		sqlite.close();
	}
}

if (import.meta.main) {
	await seed();
}
