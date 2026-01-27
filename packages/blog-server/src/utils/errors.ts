export type BaseServiceError = {
	kind: string;
	message?: string;
	resource?: string;
	slug?: string;
	inner?: { kind: string; message?: string; path?: string };
};

export type ErrorResponse = {
	status: 400 | 404 | 409 | 500 | 502;
	body: { code: string; message: string };
};

const ERROR_MAPPINGS: Record<string, { status: ErrorResponse["status"]; code: string; defaultMessage: string }> = {
	not_found: { status: 404, code: "NOT_FOUND", defaultMessage: "Resource not found" },
	conflict: { status: 409, code: "CONFLICT", defaultMessage: "Resource conflict" },
	slug_conflict: { status: 409, code: "CONFLICT", defaultMessage: "Slug already exists" },
	has_children: { status: 409, code: "CONFLICT", defaultMessage: "Cannot delete resource with children" },
	has_posts: { status: 409, code: "CONFLICT", defaultMessage: "Cannot delete resource with posts" },
	parent_not_found: { status: 400, code: "BAD_REQUEST", defaultMessage: "Parent category does not exist" },
	db_error: { status: 500, code: "DB_ERROR", defaultMessage: "Database operation failed" },
	corpus_error: { status: 500, code: "CORPUS_ERROR", defaultMessage: "Corpus operation failed" },
	provider_error: { status: 502, code: "PROVIDER_ERROR", defaultMessage: "External provider error" },
	validation_error: { status: 400, code: "VALIDATION_ERROR", defaultMessage: "Invalid input" },
};

const buildMessage = (error: BaseServiceError, defaultMessage: string): string => {
	if (error.message) return error.message;
	if (error.inner?.message) return error.inner.message;
	if (error.resource) return `${defaultMessage}: ${error.resource}`;
	if (error.slug) return `${defaultMessage}: ${error.slug}`;
	return defaultMessage;
};

export const errorMap = {
	response: (error: BaseServiceError): ErrorResponse => {
		const mapping = ERROR_MAPPINGS[error.kind];

		if (!mapping) {
			return {
				status: 500,
				body: { code: "UNKNOWN_ERROR", message: error.message ?? "An unexpected error occurred" },
			};
		}

		return {
			status: mapping.status,
			body: {
				code: mapping.code,
				message: buildMessage(error, mapping.defaultMessage),
			},
		};
	},
};
