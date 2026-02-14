import type { ServiceError } from "@devpad/schema/errors";
import type { Result } from "@f0rbit/corpus";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

type ErrorMapping = {
	status: 400 | 401 | 403 | 404 | 409 | 500 | 502;
	code: string;
	defaultMessage: string;
};

export const ERROR_MAPPINGS: Record<string, ErrorMapping> = {
	not_found: { status: 404, code: "NOT_FOUND", defaultMessage: "Resource not found" },
	forbidden: { status: 403, code: "FORBIDDEN", defaultMessage: "Access denied" },
	unauthorized: { status: 401, code: "UNAUTHORIZED", defaultMessage: "Authentication required" },
	bad_request: { status: 400, code: "BAD_REQUEST", defaultMessage: "Invalid request" },
	conflict: { status: 409, code: "CONFLICT", defaultMessage: "Resource conflict" },
	validation: { status: 400, code: "VALIDATION_ERROR", defaultMessage: "Validation failed" },
	rate_limited: { status: 500, code: "RATE_LIMITED", defaultMessage: "Rate limited" },
	network_error: { status: 500, code: "NETWORK_ERROR", defaultMessage: "Network error" },
	auth_expired: { status: 403, code: "AUTH_EXPIRED", defaultMessage: "Authentication expired" },
	api_error: { status: 500, code: "API_ERROR", defaultMessage: "API error" },
	encryption_error: { status: 500, code: "ENCRYPTION_ERROR", defaultMessage: "Failed to process encryption" },
	store_error: { status: 500, code: "STORE_ERROR", defaultMessage: "Storage operation failed" },
	parse_error: { status: 500, code: "PARSE_ERROR", defaultMessage: "Failed to parse data" },
	db_error: { status: 500, code: "DB_ERROR", defaultMessage: "Database operation failed" },
	scan_error: { status: 500, code: "SCAN_ERROR", defaultMessage: "Code scanning failed" },
	github_error: { status: 502, code: "GITHUB_ERROR", defaultMessage: "GitHub operation failed" },
	slug_conflict: { status: 409, code: "CONFLICT", defaultMessage: "Slug already exists" },
	has_children: { status: 409, code: "CONFLICT", defaultMessage: "Cannot delete resource with children" },
	has_posts: { status: 409, code: "CONFLICT", defaultMessage: "Cannot delete resource with posts" },
	parent_not_found: { status: 400, code: "BAD_REQUEST", defaultMessage: "Parent category does not exist" },
	corpus_error: { status: 500, code: "CORPUS_ERROR", defaultMessage: "Corpus operation failed" },
	provider_error: { status: 502, code: "PROVIDER_ERROR", defaultMessage: "External provider error" },
};

type ExtendedError = ServiceError & Record<string, unknown>;

const ERROR_NAMES: Record<number, string> = {
	400: "Bad request",
	401: "Unauthorized",
	403: "Forbidden",
	404: "Not found",
	409: "Conflict",
	500: "Internal server error",
	502: "Bad gateway",
};

const buildMessage = (error: ExtendedError, defaultMessage: string): string => {
	if (error.message) return error.message;
	if ("inner" in error && typeof error.inner === "object" && error.inner && "message" in error.inner) return String(error.inner.message);
	if ("resource" in error && error.resource) return `${defaultMessage}: ${error.resource}`;
	if ("slug" in error && error.slug) return `${defaultMessage}: ${error.slug}`;
	return defaultMessage;
};

type ErrorResponseBody = { error: string; message: string; details?: unknown };
type ErrorResponse = {
	status: ErrorMapping["status"];
	body: ErrorResponseBody;
};

export const mapErrorToResponse = (error: ExtendedError): ErrorResponse => {
	const mapping = ERROR_MAPPINGS[error.kind];

	if (!mapping) {
		return {
			status: 500,
			body: { error: "Internal server error", message: error.message ?? "An unexpected error occurred" },
		};
	}

	const body: ErrorResponseBody = {
		error: ERROR_NAMES[mapping.status] ?? "Error",
		message: buildMessage(error, mapping.defaultMessage),
	};

	if ("details" in error && error.details !== undefined) {
		body.details = error.details;
	}

	return { status: mapping.status, body };
};

export const handleResult = <T>(c: Context, result: Result<T, ServiceError>, successStatus: ContentfulStatusCode = 200): Response => {
	if (!result.ok) {
		const { status, body } = mapErrorToResponse(result.error);
		return c.json(body, status);
	}
	return c.json(result.value as object, successStatus);
};

export const handleResultWith = <T, R>(c: Context, result: Result<T, ServiceError>, mapper: (value: T) => R, successStatus: ContentfulStatusCode = 200): Response => {
	if (!result.ok) {
		const { status, body } = mapErrorToResponse(result.error);
		return c.json(body, status);
	}
	return c.json(mapper(result.value) as object, successStatus);
};

export const handleResultNoContent = <T>(c: Context, result: Result<T, ServiceError>): Response => {
	if (!result.ok) {
		const { status, body } = mapErrorToResponse(result.error);
		return c.json(body, status);
	}
	return c.body(null, 204);
};

const httpError = (c: Context, status: ContentfulStatusCode, message: string, details?: unknown): Response => {
	const body: ErrorResponseBody = { error: ERROR_NAMES[status] ?? "Error", message };
	if (details !== undefined) body.details = details;
	return c.json(body, status);
};

export const badRequest = (c: Context, message: string, details?: unknown) => httpError(c, 400, message, details);
export const unauthorized = (c: Context, message: string) => httpError(c, 401, message);
export const forbidden = (c: Context, message: string) => httpError(c, 403, message);
export const notFound = (c: Context, message: string) => httpError(c, 404, message);
export const conflict = (c: Context, message: string) => httpError(c, 409, message);
export const serverError = (c: Context, message: string) => httpError(c, 500, message);

export const response = {
	result: <T>(c: Context, result: Result<T, ServiceError>, successStatus: ContentfulStatusCode = 200): Response => handleResult(c, result, successStatus),
	with: <T, R>(c: Context, result: Result<T, ServiceError>, mapper: (value: T) => R, successStatus: ContentfulStatusCode = 200): Response => handleResultWith(c, result, mapper, successStatus),
	empty: <T>(c: Context, result: Result<T, ServiceError>): Response => handleResultNoContent(c, result),
};

export const errorMap = {
	response: mapErrorToResponse,
};

type ValidTarget = "query" | "param" | "json";
export const valid = <T>(c: Context, target: ValidTarget): T => (c.req.valid as (t: ValidTarget) => T)(target);
