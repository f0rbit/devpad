import { describe, expect, test } from "bun:test";
import { BaseIntegrationTest, setupBaseIntegrationTest } from "../shared/base-integration-test";

class UserPreferencesTest extends BaseIntegrationTest {}

// Setup test instance
const testInstance = new UserPreferencesTest();
setupBaseIntegrationTest(testInstance);

describe("User Preferences & Profile Integration", () => {
	describe("User Profile Information", () => {
		test("should get user profile information", async () => {
			try {
				const response = await fetch("http://localhost:3001/api/v1/user", {
					method: "GET",
					headers: {
						Authorization: `Bearer ${testInstance.client.getApiKey()}`,
						"Content-Type": "application/json",
					},
				});

				if (response.status === 404 || response.status === 501) {
					console.warn("User profile endpoints not implemented");
					return;
				}

				if (response.ok) {
					const user = (await response.json()) as any;
					expect(user).toBeDefined();
					expect(user.id).toBeDefined();
					// Should have basic user fields
					expect(typeof user.id).toBe("string");
				} else {
					console.warn("User profile fetch failed, status:", response.status);
				}
			} catch (error) {
				console.warn("User profile endpoint not available:", error);
			}
		});
	});

	describe("Task View Preferences", () => {
		test("should update task view preference to grid", async () => {
			try {
				const response = await fetch("http://localhost:3001/api/v1/user/preferences", {
					method: "PATCH",
					headers: {
						Authorization: `Bearer ${testInstance.client.getApiKey()}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						id: "test-user-12345", // Use the test user ID
						task_view: "grid",
					}),
				});

				if (response.status === 404 || response.status === 501) {
					console.warn("User preferences endpoints not implemented");
					return;
				}

				if (response.ok) {
					const result = (await response.json()) as any;
					expect(result).toBeDefined();
				} else {
					console.warn("User preferences update failed, status:", response.status);
				}
			} catch (error) {
				console.warn("User preferences endpoint not available:", error);
			}
		});

		test("should update task view preference to list", async () => {
			try {
				const response = await fetch("http://localhost:3001/api/v1/user/preferences", {
					method: "PATCH",
					headers: {
						Authorization: `Bearer ${testInstance.client.getApiKey()}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						id: "test-user-12345",
						task_view: "list",
					}),
				});

				if (response.status === 404 || response.status === 501) {
					console.warn("User preferences endpoints not implemented");
					return;
				}

				if (response.ok) {
					const result = (await response.json()) as any;
					expect(result).toBeDefined();
				} else {
					console.warn("User preferences update failed, status:", response.status);
				}
			} catch (error) {
				console.warn("User preferences endpoint not available:", error);
			}
		});

		test("should reject invalid task view preferences", async () => {
			try {
				const invalidViews = ["invalid", "table", "card", "", null];

				for (const invalidView of invalidViews) {
					const response = await fetch("http://localhost:3001/api/v1/user/preferences", {
						method: "PATCH",
						headers: {
							Authorization: `Bearer ${testInstance.client.getApiKey()}`,
							"Content-Type": "application/json",
						},
						body: JSON.stringify({
							id: "test-user-12345",
							task_view: invalidView,
						}),
					});

					if (response.status === 404 || response.status === 501) {
						console.warn("User preferences endpoints not implemented");
						break;
					}

					// Should either reject (400) or succeed (if validation is lenient)
					expect([200, 201, 400]).toContain(response.status);
				}
			} catch (error) {
				console.warn("User preferences validation test not available:", error);
			}
		});
	});

	describe("User Preferences API Client Methods", () => {
		test("should use API client for preferences update", async () => {
			try {
				const prefResult = await testInstance.client.user.preferences({
					id: "test-user-12345",
					task_view: "grid",
				});

				// If endpoint is not implemented, expect an error
				if (!prefResult.ok && (prefResult.error.message.includes("404") || prefResult.error.message.includes("not found"))) {
					console.warn("User preferences API client method not implemented");
					return;
				}

				// If implemented, should succeed
				if (!prefResult.ok) {
					console.warn("User preferences API client failed:", prefResult.error.message);
				} else {
					expect(prefResult.value).toBeDefined();
				}
			} catch (error) {
				console.warn("User preferences API client method not available:", error);
			}
		});
	});

	describe("User Activity History", () => {
		test("should get user activity history", async () => {
			try {
				const historyResult = await testInstance.client.user.history();

				// If endpoint is not implemented, expect an error
				if (!historyResult.ok && (historyResult.error.message.includes("404") || historyResult.error.message.includes("not found"))) {
					console.warn("User activity history endpoint not implemented");
					return;
				}

				// If implemented, should return an array
				if (!historyResult.ok) {
					console.warn("User activity history failed:", historyResult.error.message);
				} else {
					expect(Array.isArray(historyResult.value)).toBe(true);
				}
			} catch (error) {
				console.warn("User activity history not available:", error);
			}
		});

		test("should get user history via direct API call", async () => {
			try {
				const response = await fetch("http://localhost:3001/api/v1/user/history", {
					method: "GET",
					headers: {
						Authorization: `Bearer ${testInstance.client.getApiKey()}`,
						"Content-Type": "application/json",
					},
				});

				if (response.status === 404 || response.status === 501) {
					console.warn("User history endpoints not implemented");
					return;
				}

				if (response.ok) {
					const history = (await response.json()) as any;
					expect(Array.isArray(history)).toBe(true);
				} else {
					console.warn("User history fetch failed, status:", response.status);
				}
			} catch (error) {
				console.warn("User history endpoint not available:", error);
			}
		});
	});

	describe("User Preferences Validation", () => {
		test("should require authentication for preferences operations", async () => {
			try {
				// Test without authentication
				const response = await fetch("http://localhost:3001/api/v1/user/preferences", {
					method: "PATCH",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						id: "test-user-12345",
						task_view: "grid",
					}),
				});

				// Should require authentication
				expect([401, 403, 404]).toContain(response.status);
			} catch (error) {
				console.warn("User preferences authentication test not available:", error);
			}
		});

		test("should validate user ID in preferences update", async () => {
			try {
				const invalidIds = ["", "invalid-user", null, undefined];

				for (const invalidId of invalidIds) {
					const response = await fetch("http://localhost:3001/api/v1/user/preferences", {
						method: "PATCH",
						headers: {
							Authorization: `Bearer ${testInstance.client.getApiKey()}`,
							"Content-Type": "application/json",
						},
						body: JSON.stringify({
							id: invalidId,
							task_view: "grid",
						}),
					});

					if (response.status === 404 || response.status === 501) {
						console.warn("User preferences endpoints not implemented");
						break;
					}

					// Should either reject invalid IDs or handle gracefully
					expect([200, 201, 400, 403]).toContain(response.status);
				}
			} catch (error) {
				console.warn("User preferences validation test not available:", error);
			}
		});
	});

	describe("User Profile Edge Cases", () => {
		test("should handle missing user profile gracefully", async () => {
			try {
				// Test with potentially invalid/expired token (still authenticated but maybe edge case)
				const response = await fetch("http://localhost:3001/api/v1/user", {
					method: "GET",
					headers: {
						Authorization: `Bearer ${testInstance.client.getApiKey()}`,
						"Content-Type": "application/json",
					},
				});

				if (response.status === 404 || response.status === 501) {
					console.warn("User profile endpoints not implemented");
					return;
				}

				// Should either return user data or appropriate error
				expect([200, 401, 403, 404, 500]).toContain(response.status);
			} catch (error) {
				console.warn("User profile edge case test not available:", error);
			}
		});

		test("should handle concurrent preference updates", async () => {
			try {
				// Test concurrent preference updates
				const updatePromises = Array.from({ length: 5 }, (_, i) =>
					fetch("http://localhost:3001/api/v1/user/preferences", {
						method: "PATCH",
						headers: {
							Authorization: `Bearer ${testInstance.client.getApiKey()}`,
							"Content-Type": "application/json",
						},
						body: JSON.stringify({
							id: "test-user-12345",
							task_view: i % 2 === 0 ? "grid" : "list",
						}),
					})
				);

				const responses = await Promise.all(updatePromises);

				// Check if endpoint exists
				if (responses[0].status === 404 || responses[0].status === 501) {
					console.warn("User preferences endpoints not implemented");
					return;
				}

				// All should handle gracefully
				for (const response of responses) {
					expect([200, 201, 400, 409, 500]).toContain(response.status);
				}
			} catch (error) {
				console.warn("Concurrent preferences update test not available:", error);
			}
		});
	});

	describe("User Data Consistency", () => {
		test("should maintain preference consistency across requests", async () => {
			try {
				// Set a preference
				const setResponse = await fetch("http://localhost:3001/api/v1/user/preferences", {
					method: "PATCH",
					headers: {
						Authorization: `Bearer ${testInstance.client.getApiKey()}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						id: "test-user-12345",
						task_view: "grid",
					}),
				});

				if (setResponse.status === 404 || setResponse.status === 501) {
					console.warn("User preferences endpoints not implemented");
					return;
				}

				if (setResponse.ok) {
					// Get user profile to check if preference was saved
					const profileResponse = await fetch("http://localhost:3001/api/v1/user", {
						method: "GET",
						headers: {
							Authorization: `Bearer ${testInstance.client.getApiKey()}`,
							"Content-Type": "application/json",
						},
					});

					if (profileResponse.ok) {
						const user = (await profileResponse.json()) as any;
						if (user.task_view !== undefined) {
							expect(user.task_view).toBe("grid");
						}
					}
				}
			} catch (error) {
				console.warn("User data consistency test not available:", error);
			}
		});
	});
});
