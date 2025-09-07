import { describe, expect, it } from "bun:test";
import { ApiError, AuthenticationError, NetworkError, ValidationError } from "../../../src/errors";
import { getUserFriendlyErrorMessage, parseZodErrors } from "../../../src/error-handlers";

describe("User-friendly error messages", () => {
	describe("parseZodErrors", () => {
		it("should parse simple Zod validation errors", () => {
			const zodError = JSON.stringify({
				issues: [
					{
						code: "invalid_type",
						expected: "string",
						received: "number",
						path: ["username"],
						message: "Expected string, received number",
					},
				],
			});

			const result = parseZodErrors(zodError);
			expect(result).toBe("username must be a string (received number)");
		});

		it("should parse multiple Zod validation errors", () => {
			const zodError = JSON.stringify({
				issues: [
					{
						code: "too_small",
						type: "string",
						minimum: 3,
						path: ["username"],
						message: "String must contain at least 3 character(s)",
					},
					{
						code: "invalid_string",
						validation: "email",
						path: ["email"],
						message: "Invalid email",
					},
				],
			});

			const result = parseZodErrors(zodError);
			expect(result).toContain("username must be at least 3 characters long");
			expect(result).toContain("email must be a valid email address");
		});

		it("should handle email validation errors", () => {
			const zodError = JSON.stringify({
				issues: [
					{
						code: "invalid_string",
						validation: "email",
						path: ["email"],
						message: "Invalid email",
					},
				],
			});

			const result = parseZodErrors(zodError);
			expect(result).toBe("email must be a valid email address");
		});

		it("should handle URL validation errors", () => {
			const zodError = JSON.stringify({
				issues: [
					{
						code: "invalid_string",
						validation: "url",
						path: ["website"],
						message: "Invalid url",
					},
				],
			});

			const result = parseZodErrors(zodError);
			expect(result).toBe("website must be a valid URL");
		});

		it("should handle string length errors", () => {
			const zodError = JSON.stringify({
				issues: [
					{
						code: "too_big",
						type: "string",
						maximum: 100,
						path: ["description"],
						message: "String must contain at most 100 character(s)",
					},
				],
			});

			const result = parseZodErrors(zodError);
			expect(result).toBe("description must be no more than 100 characters long");
		});

		it("should fall back to original message for unparseable errors", () => {
			const invalidError = "This is not a valid JSON error";
			const result = parseZodErrors(invalidError);
			expect(result).toBe(invalidError);
		});
	});

	describe("getUserFriendlyErrorMessage", () => {
		it("should return friendly message for AuthenticationError", () => {
			const error = new AuthenticationError();
			const result = getUserFriendlyErrorMessage(error);
			expect(result).toBe("Please check your API key and try again");
		});

		it("should return friendly message for NetworkError", () => {
			const error = new NetworkError();
			const result = getUserFriendlyErrorMessage(error);
			expect(result).toBe("Network connection issue. Please try again");
		});

		it("should return friendly message for ValidationError with Zod details", () => {
			const zodError = JSON.stringify({
				issues: [
					{
						code: "invalid_type",
						expected: "string",
						received: "number",
						path: ["name"],
						message: "Expected string, received number",
					},
				],
			});
			const error = new ValidationError(zodError);
			const result = getUserFriendlyErrorMessage(error);
			expect(result).toBe("name must be a string (received number)");
		});

		it("should handle NOT_FOUND ApiError", () => {
			const error = new ApiError("Resource not found", { statusCode: 404 });
			const result = getUserFriendlyErrorMessage(error);
			expect(result).toBe("The requested resource was not found");
		});

		it("should handle BAD_REQUEST ApiError", () => {
			const error = new ApiError("Bad request", { statusCode: 400 });
			const result = getUserFriendlyErrorMessage(error);
			expect(result).toBe("Invalid request. Please check your data");
		});

		it("should handle unknown errors", () => {
			const error = new Error("Some unknown error");
			const result = getUserFriendlyErrorMessage(error);
			expect(result).toBe("An unexpected error occurred");
		});

		it("should handle generic ApiError with message", () => {
			const error = new ApiError("Custom error message", { statusCode: 500 });
			const result = getUserFriendlyErrorMessage(error);
			expect(result).toBe("Custom error message");
		});
	});
});
