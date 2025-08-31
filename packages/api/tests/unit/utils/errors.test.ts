import { describe, expect, test } from "bun:test";
import { ApiError, AuthenticationError, NetworkError, ValidationError } from "../../../src/utils/errors";

describe("ApiError", () => {
	test("should create basic error with message", () => {
		const error = new ApiError("Something went wrong");

		expect(error).toBeInstanceOf(Error);
		expect(error).toBeInstanceOf(ApiError);
		expect(error.name).toBe("ApiError");
		expect(error.message).toBe("Something went wrong");
		expect(error.code).toBeUndefined();
		expect(error.statusCode).toBeUndefined();
	});

	test("should create error with code and statusCode", () => {
		const error = new ApiError("Bad request", {
			code: "INVALID_INPUT",
			statusCode: 400,
		});

		expect(error.message).toBe("Bad request");
		expect(error.code).toBe("INVALID_INPUT");
		expect(error.statusCode).toBe(400);
		expect(error.name).toBe("ApiError");
	});

	test("should handle partial options", () => {
		const errorWithCode = new ApiError("Error with code", {
			code: "TEST_CODE",
		});
		expect(errorWithCode.code).toBe("TEST_CODE");
		expect(errorWithCode.statusCode).toBeUndefined();

		const errorWithStatus = new ApiError("Error with status", {
			statusCode: 500,
		});
		expect(errorWithStatus.statusCode).toBe(500);
		expect(errorWithStatus.code).toBeUndefined();
	});

	test("should create error from Response object", () => {
		const mockResponse = {
			status: 404,
			statusText: "Not Found",
		} as Response;

		const error = ApiError.fromResponse(mockResponse);

		expect(error.message).toBe("API request failed: Not Found");
		expect(error.statusCode).toBe(404);
		expect(error.name).toBe("ApiError");
	});

	test("should handle Response with empty statusText", () => {
		const mockResponse = {
			status: 500,
			statusText: "",
		} as Response;

		const error = ApiError.fromResponse(mockResponse);

		expect(error.message).toBe("API request failed: ");
		expect(error.statusCode).toBe(500);
	});
});

describe("AuthenticationError", () => {
	test("should create with default message", () => {
		const error = new AuthenticationError();

		expect(error).toBeInstanceOf(ApiError);
		expect(error).toBeInstanceOf(AuthenticationError);
		expect(error.message).toBe("Authentication failed");
		expect(error.code).toBe("AUTHENTICATION_ERROR");
		expect(error.name).toBe("ApiError");
	});

	test("should create with custom message", () => {
		const error = new AuthenticationError("Invalid API key provided");

		expect(error.message).toBe("Invalid API key provided");
		expect(error.code).toBe("AUTHENTICATION_ERROR");
	});

	test("should inherit from ApiError", () => {
		const error = new AuthenticationError();

		expect(error instanceof ApiError).toBe(true);
		expect(error instanceof AuthenticationError).toBe(true);
		expect(error instanceof Error).toBe(true);
	});
});

describe("NetworkError", () => {
	test("should create with default message", () => {
		const error = new NetworkError();

		expect(error).toBeInstanceOf(ApiError);
		expect(error).toBeInstanceOf(NetworkError);
		expect(error.message).toBe("Network request failed");
		expect(error.code).toBe("NETWORK_ERROR");
		expect(error.name).toBe("ApiError");
	});

	test("should create with custom message", () => {
		const error = new NetworkError("Connection timeout");

		expect(error.message).toBe("Connection timeout");
		expect(error.code).toBe("NETWORK_ERROR");
	});

	test("should inherit from ApiError", () => {
		const error = new NetworkError();

		expect(error instanceof ApiError).toBe(true);
		expect(error instanceof NetworkError).toBe(true);
		expect(error instanceof Error).toBe(true);
	});
});

describe("ValidationError", () => {
	test("should create with default message", () => {
		const error = new ValidationError();

		expect(error).toBeInstanceOf(ApiError);
		expect(error).toBeInstanceOf(ValidationError);
		expect(error.message).toBe("Validation failed");
		expect(error.code).toBe("VALIDATION_ERROR");
		expect(error.name).toBe("ApiError");
	});

	test("should create with custom message", () => {
		const error = new ValidationError("Required field missing: name");

		expect(error.message).toBe("Required field missing: name");
		expect(error.code).toBe("VALIDATION_ERROR");
	});

	test("should inherit from ApiError", () => {
		const error = new ValidationError();

		expect(error instanceof ApiError).toBe(true);
		expect(error instanceof ValidationError).toBe(true);
		expect(error instanceof Error).toBe(true);
	});
});

describe("Error stack traces and serialization", () => {
	test("should preserve stack traces", () => {
		const error = new ApiError("Test error");

		expect(error.stack).toBeDefined();
		expect(typeof error.stack).toBe("string");
		expect(error.stack).toContain("ApiError");
	});

	test("should be serializable to JSON", () => {
		const error = new ApiError("Test error", {
			code: "TEST_CODE",
			statusCode: 400,
		});

		// JSON.stringify won't include non-enumerable properties by default
		const serialized = JSON.stringify({
			name: error.name,
			message: error.message,
			code: error.code,
			statusCode: error.statusCode,
		});

		const parsed = JSON.parse(serialized);

		expect(parsed.name).toBe("ApiError");
		expect(parsed.message).toBe("Test error");
		expect(parsed.code).toBe("TEST_CODE");
		expect(parsed.statusCode).toBe(400);
	});

	test("should handle toString() correctly", () => {
		const error = new ApiError("Test error");
		const errorString = error.toString();

		expect(errorString).toContain("ApiError");
		expect(errorString).toContain("Test error");
	});
});

describe("Error inheritance chain", () => {
	test("should maintain proper prototype chain for ApiError", () => {
		const error = new ApiError("Test");

		expect(Object.getPrototypeOf(error)).toBe(ApiError.prototype);
		expect(Object.getPrototypeOf(ApiError.prototype)).toBe(Error.prototype);
	});

	test("should maintain proper prototype chain for specialized errors", () => {
		const authError = new AuthenticationError();
		const networkError = new NetworkError();
		const validationError = new ValidationError();

		// Check immediate prototype
		expect(Object.getPrototypeOf(authError)).toBe(AuthenticationError.prototype);
		expect(Object.getPrototypeOf(networkError)).toBe(NetworkError.prototype);
		expect(Object.getPrototypeOf(validationError)).toBe(ValidationError.prototype);

		// Check inheritance chain
		expect(Object.getPrototypeOf(AuthenticationError.prototype)).toBe(ApiError.prototype);
		expect(Object.getPrototypeOf(NetworkError.prototype)).toBe(ApiError.prototype);
		expect(Object.getPrototypeOf(ValidationError.prototype)).toBe(ApiError.prototype);
	});

	test("should work correctly with instanceof checks", () => {
		const baseError = new ApiError("Base error");
		const authError = new AuthenticationError("Auth error");
		const networkError = new NetworkError("Network error");
		const validationError = new ValidationError("Validation error");

		// Base error
		expect(baseError instanceof Error).toBe(true);
		expect(baseError instanceof ApiError).toBe(true);
		expect(baseError instanceof AuthenticationError).toBe(false);

		// Authentication error
		expect(authError instanceof Error).toBe(true);
		expect(authError instanceof ApiError).toBe(true);
		expect(authError instanceof AuthenticationError).toBe(true);
		expect(authError instanceof NetworkError).toBe(false);

		// Network error
		expect(networkError instanceof Error).toBe(true);
		expect(networkError instanceof ApiError).toBe(true);
		expect(networkError instanceof NetworkError).toBe(true);
		expect(networkError instanceof AuthenticationError).toBe(false);

		// Validation error
		expect(validationError instanceof Error).toBe(true);
		expect(validationError instanceof ApiError).toBe(true);
		expect(validationError instanceof ValidationError).toBe(true);
		expect(validationError instanceof NetworkError).toBe(false);
	});
});
