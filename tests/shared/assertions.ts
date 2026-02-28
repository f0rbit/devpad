import { expect } from "bun:test";

/**
 * Standard assertions for validating API responses and data structures
 */

export const expectValidProject = (project: any): void => {
	expect(project).toHaveProperty("id");
	expect(project).toHaveProperty("name");
	expect(project).toHaveProperty("project_id");
	expect(project).toHaveProperty("owner_id");
	expect(project).toHaveProperty("visibility");
	expect(project).toHaveProperty("status");
	expect(project).toHaveProperty("deleted");
	expect(project).toHaveProperty("created_at");
	expect(project).toHaveProperty("updated_at");

	// Validate types
	expect(typeof project.id).toBe("string");
	expect(typeof project.name).toBe("string");
	expect(typeof project.project_id).toBe("string");
	expect(typeof project.owner_id).toBe("string");
	expect(typeof project.deleted).toBe("boolean");

	// Validate enums
	expect(["PUBLIC", "PRIVATE", "HIDDEN", "ARCHIVED", "DRAFT", "DELETED"]).toContain(project.visibility);
	expect(["DEVELOPMENT", "PAUSED", "COMPLETED", "ARCHIVED", "CANCELLED", "STOPPED", "LIVE"]).toContain(project.status);
};

export const expectValidApiError = (error: any, expectedCode?: string): void => {
	expect(error).toBeInstanceOf(Error);
	expect(error).toHaveProperty("message");
	expect(typeof error.message).toBe("string");
	expect(error.message.length).toBeGreaterThan(0);

	// Check for API-specific error properties
	if (expectedCode) {
		expect(error).toHaveProperty("code");
		expect(error.code).toBe(expectedCode);
	}

	if (error.statusCode) {
		expect(typeof error.statusCode).toBe("number");
		expect(error.statusCode).toBeGreaterThanOrEqual(400);
		expect(error.statusCode).toBeLessThan(600);
	}
};

export const expectValidArray = (array: any, itemValidator?: (item: any) => void): void => {
	expect(Array.isArray(array)).toBe(true);

	if (itemValidator && array.length > 0) {
		array.forEach(itemValidator);
	}
};

/**
 * Helper to check that an object matches a partial structure
 */
export const expectMatchesPartial = <T extends Record<string, any>>(actual: T, expected: Partial<T>): void => {
	for (const [key, value] of Object.entries(expected)) {
		expect(actual).toHaveProperty(key);
		expect(actual[key]).toEqual(value);
	}
};

/**
 * Helper to expect successful API response
 */
export const expectSuccessfulResponse = (response: Response): void => {
	expect(response.ok).toBe(true);
	expect(response.status).toBeGreaterThanOrEqual(200);
	expect(response.status).toBeLessThan(300);
};
