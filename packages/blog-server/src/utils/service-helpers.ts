import { err, first, format_error, match, ok, type Result, to_nullable } from "@f0rbit/corpus";

export type ServiceError = {
	kind: "not_found" | "db_error" | "invalid_input" | "unauthorized" | "conflict";
	message?: string;
	resource?: string;
};

export const errors = {
	db: (e: unknown) => ({
		kind: "db_error" as const,
		message: format_error(e),
	}),
	missing: (resource: string) => ({
		kind: "not_found" as const,
		resource,
	}),
};

export const rows = {
	firstOr: <T, E>(rows: T[], errorFn: () => E): Result<T, E> =>
		match(
			first(rows),
			(v: T) => ok(v) as Result<T, E>,
			() => err(errorFn())
		),
	first: <T>(rows: T[]): T | null => to_nullable(first(rows)),
};
