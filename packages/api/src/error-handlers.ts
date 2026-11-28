import { try_catch } from "@f0rbit/corpus";
import { z, type ZodIssue } from "zod";
import { ApiError, AuthenticationError, NetworkError, ValidationError } from "./errors";

// Shape of a parsed HTTP error body -- genuinely unknown JSON from the wire,
// Zod-parsed just enough to detect the validation-error envelope the
// worker's `zValidator` middleware emits. Issues are checked structurally
// (an object with a `path` array); their finer shape is Zod's own.
const zod_issue = z.custom<ZodIssue>(
	(value: unknown) => typeof value === "object" && value !== null && "path" in value && Array.isArray(value.path),
);

const parsed_error_body = z.object({
	error: z
		.union([z.string(), z.object({ name: z.string().optional(), issues: z.array(zod_issue).optional() })])
		.optional(),
	issues: z.array(zod_issue).optional(),
});

type ParsedErrorBody = z.infer<typeof parsed_error_body>;

const parse_error_body = (raw: unknown): ParsedErrorBody | null => {
	const parsed = parsed_error_body.safeParse(raw);
	return parsed.success ? parsed.data : null;
};

const parse_json_error_body = (text: string): ParsedErrorBody | null => {
	const raw = try_catch(
		(): unknown => JSON.parse(text),
		(e: unknown) => e,
	);
	return raw.ok ? parse_error_body(raw.value) : null;
};

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
		default:
			// Every other non-2xx status (400, 403, 409, 422, 500, ...) falls
			// through to `handleResponseError`, which parses the JSON body for
			// the server's actual `{ error: "..." }` message — short-circuiting
			// here with a generic `statusText` (task A4.5 found this masking a
			// 409's "missing checkpoint" detail, a 403's approval_channel
			// reason, etc.) loses real diagnostic information for no benefit.
			break;
	}
}

/**
 * Parse and throw appropriate error from response text
 */
export async function handleResponseError(response: Response): Promise<never> {
	const errorText = await response.text();
	const errorMessage = errorText || "Request failed";

	// Try to parse structured error responses
	// Not JSON -> parsedError stays null, raw text is used below
	const parsedError = parse_json_error_body(errorText);

	const structuredError = typeof parsedError?.error === "object" ? parsedError.error : undefined;
	if (response.status === HTTP_STATUS.BAD_REQUEST && structuredError?.name === "ZodError") {
		// Enhanced: Create a more detailed ValidationError with the original Zod error info
		const zodErrorDetails = structuredError.issues ? JSON.stringify(structuredError) : errorMessage;
		throw new ValidationError(zodErrorDetails);
	}

	// Almost every devpad route responds `{ error: "<message>" }` on failure —
	// surface that string directly instead of the raw (JSON-quoted) body text.
	const message = typeof parsedError?.error === "string" ? parsedError.error : errorMessage;
	throw new ApiError(message, { statusCode: response.status });
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
 * Best-effort fallback parse when the raw error message isn't JSON --
 * extracted from parseZodErrors to keep nesting within the max-depth limit.
 */
function tryParseZodErrorString(errorMessage: string): ParsedErrorBody | null {
	const zodErrorMatch = errorMessage.match(/ZodError: (.+)/);
	if (!zodErrorMatch?.[1]) return null;
	const zod_json = parse_json_error_body(zodErrorMatch[1]);
	if (zod_json) return zod_json;
	// If still not JSON, try to extract from the message
	const issuesMatch = errorMessage.match(/issues:\s*(\[.*\])/s);
	if (!issuesMatch?.[1]) return null;
	const issues_json = try_catch(
		(): unknown => JSON.parse(issuesMatch[1] ?? ""),
		(e: unknown) => e,
	);
	// Fall back to basic parsing when neither probe parses
	return issues_json.ok ? parse_error_body({ issues: issues_json.value }) : null;
}

/**
 * Parse Zod validation errors into user-friendly messages
 */
export function parseZodErrors(errorMessage: string): string {
	const friendly = try_catch(
		() => friendly_validation_message(errorMessage),
		(e: unknown) => e,
	);
	if (friendly.ok && friendly.value !== null) return friendly.value;
	// Fall back to original message if parsing fails
	return errorMessage;
}

/** Extract structured Zod issues from an error message; null when not structured. */
function friendly_validation_message(errorMessage: string): string | null {
	// Try to parse as JSON first to get structured error info
	// If not JSON, try to extract Zod error details from the error message
	const parsedError = parse_json_error_body(errorMessage) ?? tryParseZodErrorString(errorMessage);

	if (parsedError?.issues && Array.isArray(parsedError.issues)) {
		const friendlyMessages = parsedError.issues.map((issue) => {
			const path = issue.path.length > 0 ? issue.path.join(".") : "field";
			const message = issue.message || "is invalid";

			// Handle common validation types with friendly messages
			switch (issue.code) {
				case "invalid_type":
					return `${path} must be a ${issue.expected} (received ${issue.received})`;
				case "too_small":
					if (issue.type === "string") {
						return `${path} must be at least ${String(issue.minimum)} characters long`;
					}
					if (issue.type === "number") {
						return `${path} must be at least ${String(issue.minimum)}`;
					}
					return `${path} is too small`;
				case "too_big":
					if (issue.type === "string") {
						return `${path} must be no more than ${String(issue.maximum)} characters long`;
					}
					if (issue.type === "number") {
						return `${path} must be no more than ${String(issue.maximum)}`;
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
				case "invalid_literal":
				case "unrecognized_keys":
				case "invalid_union":
				case "invalid_union_discriminator":
				case "invalid_enum_value":
				case "invalid_arguments":
				case "invalid_return_type":
				case "invalid_date":
				case "invalid_intersection_types":
				case "not_multiple_of":
				case "not_finite":
				default:
					return `${path}: ${message}`;
			}
		});

		if (friendlyMessages.length === 1) {
			return friendlyMessages[0] ?? errorMessage;
		}
		return `Validation failed:\n• ${friendlyMessages.join("\n• ")}`;
	}

	return null;
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
