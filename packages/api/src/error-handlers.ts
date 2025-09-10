import { ApiError, AuthenticationError, NetworkError, ValidationError } from "./errors";

/**
 * Centralized error handling utilities to reduce duplication
 * across API client methods and improve consistency
 */

/**
 * Standard HTTP status codes
 */
export const HTTP_STATUS = {
	OK: 200,
	CREATED: 201,
	NO_CONTENT: 204,
	BAD_REQUEST: 400,
	UNAUTHORIZED: 401,
	FORBIDDEN: 403,
	NOT_FOUND: 404,
	INTERNAL_SERVER_ERROR: 500,
} as const;

/**
 * Handle response based on status code with consistent error types
 */
export function handleHttpResponse(response: Response): void {
	switch (response.status) {
		case HTTP_STATUS.UNAUTHORIZED:
			throw new AuthenticationError("Invalid or expired API key");
		case HTTP_STATUS.NOT_FOUND:
			throw new ApiError("Resource not found", { statusCode: HTTP_STATUS.NOT_FOUND });
		case HTTP_STATUS.BAD_REQUEST:
			// Will be handled by specific error text parsing
			break;
		default:
			if (!response.ok) {
				throw new ApiError(`Request failed: ${response.statusText}`, { statusCode: response.status });
			}
	}
}

/**
 * Parse and throw appropriate error from response text
 */
export async function handleResponseError(response: Response): Promise<never> {
	const errorText = await response.text();
	const errorMessage = errorText || "Request failed";

	// Try to parse structured error responses
	let parsedError: any = null;
	try {
		parsedError = JSON.parse(errorText);
	} catch {
		// Not JSON, use raw text
	}

	if (response.status === HTTP_STATUS.BAD_REQUEST && parsedError?.error?.name === "ZodError") {
		// Enhanced: Create a more detailed ValidationError with the original Zod error info
		const zodErrorDetails = parsedError.error?.issues ? JSON.stringify(parsedError.error) : errorMessage;
		throw new ValidationError(zodErrorDetails);
	}

	throw new ApiError(errorMessage, { statusCode: response.status });
}

/**
 * Handle network errors consistently
 */
export function handleNetworkError(error: unknown): never {
	const message = error instanceof Error ? error.message : "Unknown network error";
	throw new NetworkError(message);
}

/**
 * Type guard to check if error is an API error
 */
export function isApiError(error: unknown): error is ApiError {
	return error instanceof ApiError;
}

/**
 * Type guard to check if error is an authentication error
 */
export function isAuthenticationError(error: unknown): error is AuthenticationError {
	return error instanceof AuthenticationError;
}

/**
 * Type guard to check if error is a network error
 */
export function isNetworkError(error: unknown): error is NetworkError {
	return error instanceof NetworkError;
}

/**
 * Parse Zod validation errors into user-friendly messages
 */
export function parseZodErrors(errorMessage: string): string {
	try {
		// Try to parse as JSON first to get structured error info
		let parsedError: any = null;
		try {
			parsedError = JSON.parse(errorMessage);
		} catch {
			// If not JSON, try to extract Zod error details from the error message
			const zodErrorMatch = errorMessage.match(/ZodError: (.+)/);
			if (zodErrorMatch && zodErrorMatch[1]) {
				try {
					parsedError = JSON.parse(zodErrorMatch[1]);
				} catch {
					// If still not JSON, try to extract from the message
					const issuesMatch = errorMessage.match(/issues:\s*(\[.*\])/s);
					if (issuesMatch && issuesMatch[1]) {
						try {
							parsedError = { issues: JSON.parse(issuesMatch[1]) };
						} catch {
							// Fall back to basic parsing
						}
					}
				}
			}
		}

		if (parsedError?.issues && Array.isArray(parsedError.issues)) {
			const friendlyMessages = parsedError.issues.map((issue: any) => {
				const path = issue.path && issue.path.length > 0 ? issue.path.join(".") : "field";
				const message = issue.message || "is invalid";

				// Handle common validation types with friendly messages
				switch (issue.code) {
					case "invalid_type":
						return `${path} must be a ${issue.expected} (received ${issue.received})`;
					case "too_small":
						if (issue.type === "string") {
							return `${path} must be at least ${issue.minimum} characters long`;
						}
						if (issue.type === "number") {
							return `${path} must be at least ${issue.minimum}`;
						}
						return `${path} is too small`;
					case "too_big":
						if (issue.type === "string") {
							return `${path} must be no more than ${issue.maximum} characters long`;
						}
						if (issue.type === "number") {
							return `${path} must be no more than ${issue.maximum}`;
						}
						return `${path} is too large`;
					case "invalid_string":
						if (issue.validation === "email") {
							return `${path} must be a valid email address`;
						}
						if (issue.validation === "url") {
							return `${path} must be a valid URL`;
						}
						if (issue.validation === "uuid") {
							return `${path} must be a valid UUID`;
						}
						return `${path} format is invalid`;
					case "custom":
						return `${path}: ${message}`;
					default:
						return `${path}: ${message}`;
				}
			});

			if (friendlyMessages.length === 1) {
				return friendlyMessages[0];
			}
			return `Validation failed:\n• ${friendlyMessages.join("\n• ")}`;
		}
	} catch (e) {
		// Fall back to original message if parsing fails
		console.debug("Failed to parse Zod error:", e);
	}

	return errorMessage;
}

/**
 * Get user-friendly error message from any error
 */
export function getUserFriendlyErrorMessage(error: unknown): string {
	if (isAuthenticationError(error)) {
		return "Please check your API key and try again";
	}

	if (isNetworkError(error)) {
		return "Network connection issue. Please try again";
	}

	if (isApiError(error)) {
		if (error.statusCode === HTTP_STATUS.NOT_FOUND) {
			return "The requested resource was not found";
		}
		if (error.statusCode === HTTP_STATUS.BAD_REQUEST) {
			return "Invalid request. Please check your data";
		}

		// Enhanced: Parse Zod validation errors for ValidationError types
		if (error.code === "VALIDATION_ERROR" && error.message) {
			return parseZodErrors(error.message);
		}

		return error.message || "An error occurred";
	}

	return "An unexpected error occurred";
}

/**
 * Retry wrapper for API calls with exponential backoff
 */
export async function withRetry<T>(operation: () => Promise<T>, maxRetries: number = 3, baseDelay: number = 1000): Promise<T> {
	let lastError: unknown;

	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			return await operation();
		} catch (error) {
			lastError = error;

			// Don't retry authentication or validation errors
			if (isAuthenticationError(error) || error instanceof ValidationError) {
				throw error;
			}

			// Don't retry on final attempt
			if (attempt === maxRetries) {
				break;
			}

			// Exponential backoff
			const delay = baseDelay * Math.pow(2, attempt - 1);
			await new Promise(resolve => setTimeout(resolve, delay));
		}
	}

	throw lastError;
}
