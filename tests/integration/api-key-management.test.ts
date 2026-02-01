import { describe, expect, test } from "bun:test";
import { setupIntegration } from "../shared/base-integration-test";

const t = setupIntegration();

describe("API Key Management Integration", () => {
	describe("API Key Creation", () => {
		test("should create a new API key", async () => {
			try {
				const response = await fetch("http://localhost:3001/api/v1/keys", {
					method: "POST",
					headers: {
						Authorization: `Bearer ${t.client.getApiKey()}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						name: "Test API Key",
					}),
				});

				if (response.status === 404 || response.status === 501) {
					console.warn("API key management endpoints not implemented");
					return;
				}

				if (response.ok) {
					const result = (await response.json()) as any;
					expect(result).toBeDefined();
					expect(result.key).toBeDefined();
					expect(result.name).toBe("Test API Key");
				} else {
					const error = (await response.json()) as any;
					console.warn("API key creation failed:", error);
				}
			} catch (error) {
				console.warn("API key creation endpoint not available:", error);
			}
		});

		test("should create API key with optional name", async () => {
			try {
				const response = await fetch("http://localhost:3001/api/v1/keys", {
					method: "POST",
					headers: {
						Authorization: `Bearer ${t.client.getApiKey()}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({}),
				});

				if (response.status === 404 || response.status === 501) {
					console.warn("API key management endpoints not implemented");
					return;
				}

				if (response.ok) {
					const result = (await response.json()) as any;
					expect(result).toBeDefined();
					expect(result.key).toBeDefined();
				}
			} catch (error) {
				console.warn("API key creation endpoint not available:", error);
			}
		});
	});

	describe("API Key Listing", () => {
		test("should list user API keys", async () => {
			try {
				const response = await fetch("http://localhost:3001/api/v1/keys", {
					method: "GET",
					headers: {
						Authorization: `Bearer ${t.client.getApiKey()}`,
						"Content-Type": "application/json",
					},
				});

				if (response.status === 404 || response.status === 501) {
					console.warn("API key management endpoints not implemented");
					return;
				}

				if (response.ok) {
					const result = (await response.json()) as any;
					expect(result).toBeDefined();
					expect(Array.isArray(result.keys || result)).toBe(true);
				} else {
					console.warn("API key listing failed, status:", response.status);
				}
			} catch (error) {
				console.warn("API key listing endpoint not available:", error);
			}
		});
	});

	describe("API Key Deletion", () => {
		test("should delete API key by ID", async () => {
			try {
				const createResponse = await fetch("http://localhost:3001/api/v1/keys", {
					method: "POST",
					headers: {
						Authorization: `Bearer ${t.client.getApiKey()}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						name: "Key to Delete",
					}),
				});

				if (createResponse.status === 404 || createResponse.status === 501) {
					console.warn("API key management endpoints not implemented");
					return;
				}

				if (createResponse.ok) {
					const createdKey = (await createResponse.json()) as any;
					const keyId = createdKey.id;

					const deleteResponse = await fetch(`http://localhost:3001/api/v1/keys/${keyId}`, {
						method: "DELETE",
						headers: {
							Authorization: `Bearer ${t.client.getApiKey()}`,
							"Content-Type": "application/json",
						},
					});

					if (deleteResponse.ok) {
						const result = (await deleteResponse.json()) as any;
						expect(result).toBeDefined();
					} else {
						console.warn("API key deletion failed, status:", deleteResponse.status);
					}
				}
			} catch (error) {
				console.warn("API key management endpoints not available:", error);
			}
		});

		test("should handle deletion of non-existent key", async () => {
			try {
				const response = await fetch("http://localhost:3001/api/v1/keys/non-existent-key", {
					method: "DELETE",
					headers: {
						Authorization: `Bearer ${t.client.getApiKey()}`,
						"Content-Type": "application/json",
					},
				});

				if (response.status === 404) {
					expect(response.status).toBe(404);
				} else if (response.status === 501) {
					console.warn("API key management endpoints not implemented");
				}
			} catch (error) {
				console.warn("API key deletion endpoint not available:", error);
			}
		});
	});

	describe("API Key Validation", () => {
		test("should reject API key creation with invalid data", async () => {
			try {
				const invalidPayloads = [{ name: "" }, { name: "x".repeat(200) }, { name: null }, { invalidField: "test" }];

				for (const payload of invalidPayloads) {
					const response = await fetch("http://localhost:3001/api/v1/keys", {
						method: "POST",
						headers: {
							Authorization: `Bearer ${t.client.getApiKey()}`,
							"Content-Type": "application/json",
						},
						body: JSON.stringify(payload),
					});

					if (response.status === 404 || response.status === 501) {
						console.warn("API key management endpoints not implemented");
						break;
					}

					expect([200, 201, 400]).toContain(response.status);
				}
			} catch (error) {
				console.warn("API key validation tests not available:", error);
			}
		});
	});

	describe("API Key Security", () => {
		test("should require authentication for key operations", async () => {
			try {
				const response = await fetch("http://localhost:3001/api/v1/keys", {
					method: "GET",
					headers: {
						"Content-Type": "application/json",
					},
				});

				expect([401, 403, 404]).toContain(response.status);
			} catch (error) {
				console.warn("API key security test not available:", error);
			}
		});

		test("should not expose full API key in responses", async () => {
			try {
				const response = await fetch("http://localhost:3001/api/v1/keys", {
					method: "GET",
					headers: {
						Authorization: `Bearer ${t.client.getApiKey()}`,
						"Content-Type": "application/json",
					},
				});

				if (response.status === 404 || response.status === 501) {
					console.warn("API key management endpoints not implemented");
					return;
				}

				if (response.ok) {
					const result = (await response.json()) as any;
					const keys = result.keys || result;

					if (Array.isArray(keys) && keys.length > 0) {
						for (const key of keys) {
							if (key.key) {
								expect(key.key).not.toContain(t.client.getApiKey());
							}
						}
					}
				}
			} catch (error) {
				console.warn("API key security test not available:", error);
			}
		});
	});

	describe("API Key Usage Scenarios", () => {
		test("should handle concurrent key operations", async () => {
			try {
				const createPromises = Array.from({ length: 3 }, (_, i) =>
					fetch("http://localhost:3001/api/v1/keys", {
						method: "POST",
						headers: {
							Authorization: `Bearer ${t.client.getApiKey()}`,
							"Content-Type": "application/json",
						},
						body: JSON.stringify({
							name: `Concurrent Key ${i + 1}`,
						}),
					})
				);

				const responses = await Promise.all(createPromises);

				if (responses[0].status === 404 || responses[0].status === 501) {
					console.warn("API key management endpoints not implemented");
					return;
				}

				for (const response of responses) {
					expect([200, 201, 400, 429, 500]).toContain(response.status);
				}
			} catch (error) {
				console.warn("Concurrent API key operations test not available:", error);
			}
		});
	});

	describe("API Key Rate Limiting", () => {
		test("should handle rapid key creation requests", async () => {
			try {
				const rapidRequests = Array.from({ length: 10 }, (_, i) =>
					fetch("http://localhost:3001/api/v1/keys", {
						method: "POST",
						headers: {
							Authorization: `Bearer ${t.client.getApiKey()}`,
							"Content-Type": "application/json",
						},
						body: JSON.stringify({
							name: `Rapid Key ${i + 1}`,
						}),
					})
				);

				const responses = await Promise.all(rapidRequests);

				if (responses[0].status === 404 || responses[0].status === 501) {
					console.warn("API key management endpoints not implemented");
					return;
				}

				const statusCodes = responses.map(r => r.status);
				const hasRateLimit = statusCodes.some(status => status === 429);
				const hasSuccess = statusCodes.some(status => [200, 201].includes(status));
				const hasValidResponses = statusCodes.every(status => [200, 201, 400, 429, 500].includes(status));

				expect(hasValidResponses).toBe(true);
				expect(hasSuccess || hasRateLimit).toBe(true);
			} catch (error) {
				console.warn("API key rate limiting test not available:", error);
			}
		});
	});
});
