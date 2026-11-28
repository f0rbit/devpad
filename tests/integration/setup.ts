/**
 * Integration test setup with global shared server
 * Uses bun's preload feature for single server instance across all tests
 */

import { afterAll, beforeAll } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { ApiClient } from "@devpad/api";
import {
	cleanupTestDatabase,
	createTestUser,
	DEBUG_LOGGING,
	log,
	TEST_USER_ID,
	waitForServer,
} from "../shared/test-utils";

export const TEST_BASE_URL = "http://localhost:3001/api/v1";
export { TEST_USER_ID, DEBUG_LOGGING };

// ─── Pipelines upstream stub (issue #156 proxy tests) ──────────────
//
// The worker's AppConfig (including `PIPELINES_API_BASE`) is snapshotted
// ONCE when the shared server starts, so the env values must be set at
// module scope here — before ANY test file's beforeAll can trigger
// `performSetup` — and the stub must live for the whole process. The stub
// records received requests; `pipelines-proxy.test.ts` asserts on them.

export const PIPELINES_STUB_PORT = 3793;
export const PIPELINES_STUB_TOKEN = "test-pipelines-token";

// Module scope: runs at import time, before any beforeAll in any file.
// Unconditional: a developer .env may carry real orchestrator values that tests must never hit.
process.env.PIPELINES_API_BASE = `http://127.0.0.1:${String(PIPELINES_STUB_PORT)}`;
process.env.PIPELINES_TOKEN = PIPELINES_STUB_TOKEN;

export type PipelinesUpstreamCall = {
	method: string;
	path: string;
	authorization: string;
	actor: string;
	actor_channel: string;
	body: string;
};

const pipelinesUpstreamCalls: PipelinesUpstreamCall[] = [];

export const getPipelinesUpstreamCalls = (): PipelinesUpstreamCall[] => pipelinesUpstreamCalls;
export const resetPipelinesUpstreamCalls = (): void => {
	pipelinesUpstreamCalls.length = 0;
};

const pipelines_stub_json = (value: unknown, status = 200): Response =>
	new Response(JSON.stringify({ ok: true, value }), { status, headers: { "content-type": "application/json" } });
export const pipelinesStubJson = pipelines_stub_json;

/* ─── Path-aware stub values ─────────────────────────────────────── */

/**
 * Schema-valid stand-ins for the orchestrator's wire DTOs
 * (`@devpad/schema/pipelines`) — the proxy now parses upstream bodies
 * per route (verification-hardening 2.2), so the stub must return
 * realistic shapes instead of a generic `{ recorded }` for the parsed
 * routes.
 */
const STUB_TIMESTAMP = "2026-01-01T00:00:00.000Z";

export const pipelines_stub_run = (): Record<string, unknown> => ({
	id: "pipeline-run_stub",
	package_id: "pipeline-package_stub",
	version_set_id: "vs_stub",
	commit_sha: null,
	shape: "gradual",
	kind: "deploy",
	status: "queued",
	current_stage: null,
	resolved_rollout: { type: "atomic" },
	resolved_gates: {},
	forced_atomic_reason: null,
	started_at: null,
	finished_at: null,
	error: null,
	created_at: STUB_TIMESTAMP,
	updated_at: STUB_TIMESTAMP,
	deleted: false,
	created_by: "user",
	modified_by: "user",
	protected: false,
});

const pipelines_stub_grant = (): Record<string, unknown> => ({
	id: "pipeline-grant_stub",
	package_id: "pipeline-package_stub",
	stage_name: "production",
	scope: "anthropic:messages",
	granted_by: null,
	granted_at: null,
	auto_approved: false,
	created_at: STUB_TIMESTAMP,
	updated_at: STUB_TIMESTAMP,
	deleted: false,
	created_by: "user",
	modified_by: "user",
	protected: false,
});

const pipelines_stub_package = (): Record<string, unknown> => ({
	id: "pipeline-package_stub",
	owner_id: "user_stub",
	name: "stub",
	repo_url: null,
	default_template_ref: null,
	script_name_overrides: null,
	project_id: null,
	deploy_mode: "orchestrated",
	external_target: null,
	created_at: STUB_TIMESTAMP,
	updated_at: STUB_TIMESTAMP,
	deleted: false,
	created_by: "user",
	modified_by: "user",
	protected: false,
});

const stub_value_for = (method: string, pathname: string): unknown => {
	if (pathname.endsWith("/dispatches"))
		return { run_id: "pipeline-run_stub", run_status: "deploying", commit_sha: null, dispatches: [] };
	if (/\/runs\/[^/]+$/.test(pathname)) return pipelines_stub_run();
	if (pathname === "/runs") return [];
	if (/\/runs\/[^/]+\/events$/.test(pathname))
		return method === "POST" ? { event_id: "pipeline-stage-event_stub", duplicated: false, tick: "applied" } : [];
	if (pathname === "/grants") return [];
	if (/\/grants\/[^/]+\/approve$/.test(pathname)) return pipelines_stub_grant();
	if (pathname === "/packages") return method === "GET" ? [] : pipelines_stub_package();
	if (/^\/packages(\/|$)/.test(pathname)) return pipelines_stub_package();
	return { recorded: method };
};

/**
 * Test-only override: when set, its response wins for the requests it
 * answers (return `null` to fall through to the path-aware defaults).
 */
export type PipelinesStubResponder = (context: {
	method: string;
	pathname: string;
	url: URL;
	request: Request;
}) => Response | null;

let pipelines_stub_responder: PipelinesStubResponder | null = null;

export const setPipelinesStubResponder = (responder: PipelinesStubResponder | null): void => {
	pipelines_stub_responder = responder;
};

const handlePipelinesStubFetch = async (request: Request): Promise<Response> => {
	const url = new URL(request.url);
	const body = await request.text();
	pipelinesUpstreamCalls.push({
		method: request.method,
		path: url.pathname,
		authorization: request.headers.get("authorization") ?? "",
		actor: request.headers.get("x-devpad-actor") ?? "",
		actor_channel: request.headers.get("x-devpad-actor-channel") ?? "",
		body,
	});
	const override = pipelines_stub_responder?.({
		method: request.method,
		pathname: url.pathname,
		url,
		request,
	});
	if (override !== null && override !== undefined) return override;
	return pipelines_stub_json(stub_value_for(request.method, url.pathname));
};

let pipelinesStubServer: ReturnType<typeof Bun.serve> | null = null;

// Global shared server state
let honoServer: ReturnType<typeof Bun.serve> | null = null;
let testApiKey: string | null = null;
let testClient: ApiClient | null = null;
let setupPromise: Promise<void> | null = null;
let isSetupComplete = false;

/**
 * Perform the actual setup logic
 */
async function performSetup(): Promise<void> {
	if (isSetupComplete) return;

	log("🌍 Starting integration test setup...");

	// Set environment variables early
	const baseDir = path.resolve(process.cwd());
	const dbPath = path.join(baseDir, "database", "test.db");
	process.env.NODE_ENV = "test";
	process.env.DATABASE_URL = `sqlite://${dbPath}`;
	process.env.DATABASE_FILE = dbPath;

	const dbDir = path.dirname(dbPath);
	if (!fs.existsSync(dbDir)) {
		fs.mkdirSync(dbDir, { recursive: true });
	}
	if (fs.existsSync(dbPath)) {
		fs.unlinkSync(dbPath);
	}

	await startHonoServer();
	log("Hono server started and ready");

	// Create test user and API key
	testApiKey = await createTestUser(dbPath);
	log("✅ Test user and API key created");

	// Create shared test client
	testClient = new ApiClient({
		base_url: TEST_BASE_URL,
		api_key: testApiKey,
	});

	isSetupComplete = true;
	log("🌍 Integration test setup completed - server ready for all tests");
}

/**
 * Ensure setup is complete (lazy initialization)
 */
async function ensureSetup(): Promise<void> {
	if (setupPromise) return setupPromise;

	setupPromise = performSetup();
	return setupPromise;
}

/**
 * Get the shared API client instance - lazily initializes if needed
 */
export async function getSharedApiClient(): Promise<ApiClient> {
	await ensureSetup();
	return testClient!;
}

/**
 * Perform cleanup of server and database
 */
export async function performCleanup(): Promise<void> {
	if (!isSetupComplete) return; // Nothing to clean up

	log("🌍 Starting integration test cleanup...");

	// Stop Hono server
	if (honoServer) {
		await honoServer.stop();
		honoServer = null;
		log("✅ Hono server stopped");
	}

	// Stop pipelines upstream stub
	if (pipelinesStubServer) {
		await pipelinesStubServer.stop();
		pipelinesStubServer = null;
	}

	// Clean up test database
	const dbPath = path.join(process.cwd(), "database", "test.db");
	cleanupTestDatabase(dbPath);
	log("✅ Test database cleaned up");

	// Reset global state
	testApiKey = null;
	testClient = null;
	setupPromise = null;
	isSetupComplete = false;

	log("🌍 Integration test cleanup completed");
}

/**
 * Global setup - runs once before all test files (when running `make integration`)
 */
beforeAll(async () => {
	log("🌍 Global beforeAll detected - using shared server setup");
	// Just ensure setup is done, lazy initialization will handle it
	await ensureSetup();
});

/**
 * Global teardown - runs once after all test files complete (when running `make integration`)
 */
afterAll(async () => {
	log("🌍 Global afterAll detected - cleaning up shared server");
	await performCleanup();
});

/**
 * Handle process exit gracefully - ensures server cleanup on any exit
 */
const cleanup = async () => {
	await performCleanup();
};

// Process-event handlers can't await — hand the promise a rejection handler
// that logs, so a failed cleanup is visible rather than dropped.
const run_cleanup = (): void => {
	cleanup().catch((error: unknown) => {
		log(`cleanup failed: ${String(error)}`);
	});
};

process.on("exit", run_cleanup);
process.on("SIGINT", run_cleanup);
process.on("SIGTERM", run_cleanup);
process.on("uncaughtException", run_cleanup);
process.on("unhandledRejection", run_cleanup);

async function startHonoServer(): Promise<void> {
	log("Starting shared Hono server in-process...");

	const databaseFile = process.env.DATABASE_FILE;
	if (!databaseFile) {
		throw new Error("DATABASE_FILE environment variable is required");
	}

	const { createBunApp, migrateBunDb } = await import("../../packages/worker/src/dev.js");

	migrateBunDb({ database_file: databaseFile, migration_paths: ["./packages/schema/src/database/drizzle"] });
	const { fetch } = createBunApp({ database_file: databaseFile });

	honoServer = Bun.serve({ port: 3001, fetch });

	pipelinesStubServer = Bun.serve({ port: PIPELINES_STUB_PORT, fetch: handlePipelinesStubFetch });

	await waitForServer("http://localhost:3001/health");
	log("Hono server started and responding");
}
