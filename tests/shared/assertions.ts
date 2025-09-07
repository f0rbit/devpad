import { expect } from "bun:test";
import type { Project, Task, TaskWithDetails, Tag } from "@devpad/schema";

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
	expect(["DEVELOPMENT", "PAUSED", "COMPLETED", "ARCHIVED", "CANCELLED", "STOPPED"]).toContain(project.status);
};

export const expectValidTask = (task: any): void => {
	expect(task).toHaveProperty("id");
	expect(task).toHaveProperty("title");
	expect(task).toHaveProperty("owner_id");
	expect(task).toHaveProperty("progress");
	expect(task).toHaveProperty("priority");
	expect(task).toHaveProperty("visibility");
	expect(task).toHaveProperty("deleted");
	expect(task).toHaveProperty("created_at");
	expect(task).toHaveProperty("updated_at");

	// Validate types
	expect(typeof task.id).toBe("string");
	expect(typeof task.title).toBe("string");
	expect(typeof task.owner_id).toBe("string");
	expect(typeof task.deleted).toBe("boolean");

	// Validate enums
	expect(["UNSTARTED", "IN_PROGRESS", "COMPLETED"]).toContain(task.progress);
	expect(["LOW", "MEDIUM", "HIGH"]).toContain(task.priority);
	expect(["PUBLIC", "PRIVATE", "HIDDEN", "ARCHIVED", "DRAFT", "DELETED"]).toContain(task.visibility);
};

export const expectValidTaskWithDetails = (taskWithDetails: any): void => {
	expect(taskWithDetails).toHaveProperty("task");
	expect(taskWithDetails).toHaveProperty("tags");

	// Validate the task itself
	expectValidTask(taskWithDetails.task);

	// Validate tags array
	expect(Array.isArray(taskWithDetails.tags)).toBe(true);
	taskWithDetails.tags.forEach((tag: any) => {
		expectValidTag(tag);
	});
};

export const expectValidTag = (tag: any): void => {
	expect(tag).toHaveProperty("id");
	expect(tag).toHaveProperty("owner_id");
	expect(tag).toHaveProperty("title");
	expect(tag).toHaveProperty("deleted");
	expect(tag).toHaveProperty("render");
	expect(tag).toHaveProperty("created_at");
	expect(tag).toHaveProperty("updated_at");

	// Validate types
	expect(typeof tag.id).toBe("string");
	expect(typeof tag.owner_id).toBe("string");
	expect(typeof tag.title).toBe("string");
	expect(typeof tag.deleted).toBe("boolean");
	expect(typeof tag.render).toBe("boolean");

	// Color can be null or string
	if (tag.color !== null) {
		expect(typeof tag.color).toBe("string");
	}
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

export const expectValidTimestamp = (timestamp: any): void => {
	expect(typeof timestamp).toBe("string");

	// Should be valid ISO string
	const date = new Date(timestamp);
	expect(date.getTime()).not.toBeNaN();

	// Should match ISO format
	const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/;
	expect(isoRegex.test(timestamp)).toBe(true);
};

export const expectValidId = (id: any, prefix?: string): void => {
	expect(typeof id).toBe("string");
	expect(id.length).toBeGreaterThan(0);
	expect(id.trim()).toBe(id); // No leading/trailing whitespace

	if (prefix) {
		expect(id.startsWith(prefix)).toBe(true);
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
 * Helper to validate pagination response structure
 */
export const expectValidPaginationResponse = (response: any): void => {
	expect(response).toHaveProperty("data");
	expect(Array.isArray(response.data)).toBe(true);

	// Optional pagination metadata
	if (response.total !== undefined) {
		expect(typeof response.total).toBe("number");
		expect(response.total).toBeGreaterThanOrEqual(0);
	}

	if (response.page !== undefined) {
		expect(typeof response.page).toBe("number");
		expect(response.page).toBeGreaterThan(0);
	}

	if (response.limit !== undefined) {
		expect(typeof response.limit).toBe("number");
		expect(response.limit).toBeGreaterThan(0);
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

/**
 * Helper to expect error API response
 */
export const expectErrorResponse = (response: Response, expectedStatus?: number): void => {
	expect(response.ok).toBe(false);
	expect(response.status).toBeGreaterThanOrEqual(400);
	expect(response.status).toBeLessThan(600);

	if (expectedStatus) {
		expect(response.status).toBe(expectedStatus);
	}
};
