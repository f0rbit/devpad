/**
 * Test User Utilities
 *
 * Centralized location for test user injection in E2E tests.
 * Only active when NODE_ENV=test and X-Test-User header is present.
 */

export const TEST_USER = {
	id: "test-user-e2e",
	github_id: null,
	name: "Test User",
	task_view: "list" as const,
	email: "test@example.com",
	email_verified: true,
	image_url: null,
};

export const TEST_SESSION = {
	id: "test-session",
	userId: "test-user-e2e",
	fresh: false,
	expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
};

export const TEST_JWT_TOKEN = "test-jwt-token";

/**
 * Check if test user injection should be enabled
 */
export function shouldInjectTestUser(headers: Headers | Record<string, string>): boolean {
	// Only inject in test environment with special header
	const isTestEnv = process.env.NODE_ENV === "test";
	const hasTestHeader = headers instanceof Headers ? headers.get("X-Test-User") === "true" : headers["X-Test-User"] === "true" || headers["x-test-user"] === "true";

	return isTestEnv && hasTestHeader;
}

/**
 * Check if a JWT token is the test token
 */
export function isTestJwtToken(token: string): boolean {
	return token === TEST_JWT_TOKEN;
}

/**
 * Check if a user is the test user
 */
export function isTestUser(user: { id: string } | null | undefined): boolean {
	return user?.id === TEST_USER.id;
}
