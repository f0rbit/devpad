import { err, ok, type Result } from "@f0rbit/corpus";

export type ApiResultError = {
	message: string;
	code?: string;
	status_code?: number;
};

export type ApiResult<T> = Result<T, ApiResultError>;

export function wrap<T>(fn: () => Promise<T>): Promise<ApiResult<T>> {
	return fn()
		.then(data => ok(data))
		.catch(error =>
			err({
				message: error.message || "Unknown error",
				code: error.code,
				status_code: error.statusCode || error.status_code,
			})
		);
}

export { ok, err, type Result };
