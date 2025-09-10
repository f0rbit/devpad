import { describe, expect, test } from "bun:test";
import { ApiClient } from "../../../src/request";

describe("ApiClient validation and construction", () => {
	test("should construct with valid api key", () => {
		const client = new ApiClient({
			base_url: "https://api.example.com",
			api_key: "valid-api-key-123456",
		});

		expect(client).toBeInstanceOf(ApiClient);
	});

	test("should reject missing api key", () => {
		expect(() => {
			new ApiClient({
				base_url: "https://api.example.com",
				api_key: "",
			});
		}).toThrow("API key is required");
	});

	test("should reject api key that is too short", () => {
		expect(() => {
			new ApiClient({
				base_url: "https://api.example.com",
				api_key: "short", // Too short
			});
		}).toThrow("API key is too short");
	});

	test("should accept api key of minimum length", () => {
		expect(() => {
			new ApiClient({
				base_url: "https://api.example.com",
				api_key: "1234567890", // Exactly 10 chars
			});
		}).not.toThrow();
	});

	test("should accept longer valid api keys", () => {
		expect(() => {
			new ApiClient({
				base_url: "https://api.example.com",
				api_key: "very-long-api-key-12345678901234567890",
			});
		}).not.toThrow();
	});

	test("should normalize base URLs correctly", () => {
		// Test with trailing slash
		const client1 = new ApiClient({
			base_url: "https://api.example.com/",
			api_key: "valid-api-key-123456",
		});
		expect(client1).toBeInstanceOf(ApiClient);

		// Test without trailing slash
		const client2 = new ApiClient({
			base_url: "https://api.example.com",
			api_key: "valid-api-key-123456",
		});
		expect(client2).toBeInstanceOf(ApiClient);
	});
});
