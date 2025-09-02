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
		throw new ValidationError(`Validation failed: ${errorMessage}`);
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
