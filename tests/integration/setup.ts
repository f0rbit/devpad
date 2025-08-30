import { type ChildProcess, spawn } from 'child_process';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import * as schema from '@devpad/schema/database';
import { user, api_key } from '@devpad/schema/database/schema';
import { DevpadApiClient } from '@devpad/api';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';

// Test constants
export const TEST_USER_ID = 'test-user-12345';
export const TEST_BASE_URL = 'http://localhost:4321/api/v0';

// Global test state
let astroProcess: ChildProcess | null = null;
let testApiKey: string | null = null;
let testClient: DevpadApiClient | null = null;

export async function setupIntegrationTests(): Promise<DevpadApiClient> {
	console.log('🧪 Setting up integration test environment...');
	
	// Kill any existing processes on port 4321
	await killProcessOnPort(4321);
	
	// Setup test database
	const dbPath = await setupTestDatabase();
	
	// Start Astro dev server
	await startAstroServer();
	
	// Create test user and API key
	testApiKey = await createTestUser(dbPath);
	
	// Create and return test client
	testClient = new DevpadApiClient({
		base_url: TEST_BASE_URL,
		api_key: testApiKey
	});
	
	console.log('✅ Integration test environment ready');
	return testClient;
}

export async function teardownIntegrationTests(): Promise<void> {
	console.log('🧹 Tearing down integration test environment...');
	
	// Stop Astro server
	if (astroProcess) {
		astroProcess.kill('SIGTERM');
		astroProcess = null;
	}
	
	// Clean up test database
	await cleanupTestDatabase();
	
	console.log('✅ Integration test environment cleaned up');
}

async function killProcessOnPort(port: number): Promise<void> {
	try {
		const proc = Bun.spawn(['lsof', '-ti', `:${port}`], {
			stdout: 'pipe'
		});
		const output = await new Response(proc.stdout).text();
		await proc.exited;
		
		if (output.trim()) {
			const pids = output.trim().split('\n');
			for (const pid of pids) {
				if (pid) {
					const killProc = Bun.spawn(['kill', '-9', pid]);
					await killProc.exited;
				}
			}
		}
	} catch (error) {
		// Process might not exist, which is fine
	}
	
	// Give time for port to be released
	await new Promise(resolve => setTimeout(resolve, 2000));
}

async function setupTestDatabase(): Promise<string> {
	const baseDir = path.resolve(process.cwd());
	const dbPath = path.join(baseDir, 'database', 'test.db');
	
	// Ensure database directory exists
	const dbDir = path.dirname(dbPath);
	if (!fs.existsSync(dbDir)) {
		fs.mkdirSync(dbDir, { recursive: true });
	}
	
	// Remove existing test database
	if (fs.existsSync(dbPath)) {
		fs.unlinkSync(dbPath);
	}
	
	// Set environment variables
	process.env.NODE_ENV = 'test';
	process.env.DATABASE_URL = `sqlite://${dbPath}`;
	process.env.DATABASE_FILE = dbPath;
	
	console.log('🗄️ Setting up test database at:', dbPath);
	
	// Run migrations
	const sqlite = new Database(dbPath);
	const db = drizzle(sqlite, { schema });
	
	const migrationsFolder = path.join(baseDir, 'packages', 'app', 'database', 'drizzle');
	migrate(db, { migrationsFolder });
	
	sqlite.close();
	
	console.log('✅ Test database setup complete');
	return dbPath;
}

async function startAstroServer(): Promise<void> {
	console.log('🚀 Starting Astro dev server...');
	
	const appDir = path.join(process.cwd(), 'packages', 'app');
	const logPath = path.join(process.cwd(), 'astro-server.log');
	
	// Start Astro server
	astroProcess = spawn('bun', ['dev'], {
		cwd: appDir,
		stdio: ['ignore', 'pipe', 'pipe'],
		env: { ...process.env }
	});
	
	// Pipe output to log file
	const logStream = fs.createWriteStream(logPath);
	astroProcess.stdout?.pipe(logStream);
	astroProcess.stderr?.pipe(logStream);
	
	// Wait for server to be ready
	const maxWait = 30;
	let waitCount = 0;
	let serverStarted = false;
	
	while (waitCount < maxWait && !serverStarted) {
		// Check if process is still running
		if (astroProcess.exitCode !== null) {
			const logs = fs.readFileSync(logPath, 'utf-8');
			throw new Error(`Astro server process died unexpectedly. Logs:\n${logs}`);
		}
		
		// Try to connect to server
		try {
			const response = await fetch(`${TEST_BASE_URL}`, { 
				signal: AbortSignal.timeout(5000) 
			});
			if (response.ok) {
				serverStarted = true;
				break;
			}
		} catch (error) {
			// Server not ready yet
		}
		
		await new Promise(resolve => setTimeout(resolve, 2000));
		waitCount++;
	}
	
	if (!serverStarted) {
		const logs = fs.readFileSync(logPath, 'utf-8');
		throw new Error(`Astro server did not start within ${maxWait} seconds. Logs:\n${logs}`);
	}
	
	console.log('✅ Astro dev server started');
}

async function createTestUser(dbPath: string): Promise<string> {
	console.log('👤 Creating test user and API key...');
	
	const sqlite = new Database(dbPath);
	const db = drizzle(sqlite, { schema });
	
	try {
		// Create test user
		const [testUser] = await db.insert(user).values({
			id: TEST_USER_ID,
			name: 'Integration Test User',
			email: `test-${Date.now()}@devpad.test`,
			github_id: null,
		}).returning();
		
		// Create API key
		const apiKeyValue = crypto.randomBytes(32).toString('hex');
		await db.insert(api_key).values({
			owner_id: testUser.id,
			hash: apiKeyValue,
		});
		
		sqlite.close();
		
		console.log('✅ Test user and API key created');
		return apiKeyValue;
	} catch (error) {
		sqlite.close();
		throw error;
	}
}

async function cleanupTestDatabase(): Promise<void> {
	const dbPath = path.join(process.cwd(), 'database', 'test.db');
	if (fs.existsSync(dbPath)) {
		fs.unlinkSync(dbPath);
	}
}

export { testClient };