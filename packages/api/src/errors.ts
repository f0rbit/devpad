export class ApiError extends Error {
	readonly code?: string;
	readonly statusCode?: number;

	constructor(
		message: string,
		options: {
			code?: string;
			statusCode?: number;
		} = {}
	) {
		super(message);
		this.name = "ApiError";
		this.code = options.code ?? undefined;
		this.statusCode = options.statusCode ?? undefined;
	}

	static fromResponse(response: Response): ApiError {
		return new ApiError(`API request failed: ${response.statusText}`, {
			statusCode: response.status,
		});
	}
}

export class AuthenticationError extends ApiError {
	constructor(message: string = "Authentication failed") {
		super(message, { code: "AUTHENTICATION_ERROR" });
	}
}

export class NetworkError extends ApiError {
	constructor(message: string = "Network request failed") {
		super(message, { code: "NETWORK_ERROR" });
	}
}

export class ValidationError extends ApiError {
	constructor(message: string = "Validation failed") {
		super(message, { code: "VALIDATION_ERROR" });
	}
}
