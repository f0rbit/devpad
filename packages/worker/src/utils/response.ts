import type { Result } from "@f0rbit/corpus";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

type ErrorMapping = {
	status: 400 | 401 | 403 | 404 | 409 | 500 | 502;
	code: string;
	defaultMessage: string;
};

export const ERROR_MAPPINGS: Record<string, ErrorMapping | undefined> = {
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

/**
 * Every service in this worker maps errors by `kind` (see ERROR_MAPPINGS) —
 * not by membership in schema's `ServiceError` union. Blog's
 * `CategoryServiceError`/`PostServiceError` and the media timeline's local
 * error unions carry kinds (`slug_conflict`, `has_children`, `has_posts`,
 * `parent_not_found`, `corpus_error`, kind-only `store_error`/`not_found`)
 * that are NOT in schema's union, so accepting only `ServiceError` rejected
 * Results those mappings were written for. The structural floor below is
 * what every mapping actually needs.
 */
type ExtendedError = { kind: string; message?: string } & Record<string, unknown>;

/**
 * Every status Hono's `c.body`/`c.json` accept for a response that carries
 * a body. Typing the list as `ContentfulStatusCode[]` makes a mistyped
 * literal a compile error; `find` narrows a runtime `number` to the union
 * without an assertion.
 */
const CONTENTFUL_STATUSES: readonly ContentfulStatusCode[] = [
	200, 201, 202, 203, 206, 207, 208, 226, 300, 301, 302, 303, 305, 307, 308, 400, 401, 402, 403, 404, 405, 406, 407,
	408, 409, 410, 411, 412, 413, 414, 415, 416, 417, 418, 421, 422, 423, 424, 425, 426, 428, 429, 431, 451, 500, 501,
	502, 503, 504, 505, 506, 507, 508, 510, 511,
];

/** Relay an upstream status code; anything outside the table (a non-standard code) surfaces as 502. */
export const contentful_status = (status: number): ContentfulStatusCode =>
	CONTENTFUL_STATUSES.find((known) => known === status) ?? 502;

const ERROR_NAMES: Record<number, string | undefined> = {
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
	if ("inner" in error && typeof error.inner === "object" && error.inner && "message" in error.inner)
		return String(error.inner.message);
	if (typeof error.resource === "string" && error.resource !== "") return `${defaultMessage}: ${error.resource}`;
	if (typeof error.slug === "string" && error.slug !== "") return `${defaultMessage}: ${error.slug}`;
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

export const handleResult = <T, E extends ExtendedError>(
	c: Context,
	result: Result<T, E>,
	successStatus: ContentfulStatusCode = 200,
): Response => {
	if (!result.ok) {
		const { status, body } = mapErrorToResponse(result.error);
		return c.json(body, status);
	}
	return c.json(result.value as object, successStatus);
};

export const handleResultWith = <T, E extends ExtendedError>(
	c: Context,
	result: Result<T, E>,
	mapper: (value: T) => unknown,
	successStatus: ContentfulStatusCode = 200,
): Response => {
	if (!result.ok) {
		const { status, body } = mapErrorToResponse(result.error);
		return c.json(body, status);
	}
	return c.json(mapper(result.value) as object, successStatus);
};

export const handleResultNoContent = <T, E extends ExtendedError>(c: Context, result: Result<T, E>): Response => {
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
	result: <T, E extends ExtendedError>(
		c: Context,
		result: Result<T, E>,
		successStatus: ContentfulStatusCode = 200,
	): Response => handleResult(c, result, successStatus),
	with: <T, E extends ExtendedError>(
		c: Context,
		result: Result<T, E>,
		mapper: (value: T) => unknown,
		successStatus: ContentfulStatusCode = 200,
	): Response => handleResultWith(c, result, mapper, successStatus),
	empty: <T, E extends ExtendedError>(c: Context, result: Result<T, E>): Response => handleResultNoContent(c, result),
};

export const errorMap = {
	response: mapErrorToResponse,
};

type ValidTarget = "query" | "param" | "json";
export const valid = (c: Context, target: ValidTarget): unknown => (c.req.valid as (t: ValidTarget) => unknown)(target);
