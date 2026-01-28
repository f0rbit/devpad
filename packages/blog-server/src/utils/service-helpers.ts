import type { DatabaseError, NotFoundError } from "@devpad/schema/errors";
import { err, first, format_error, match, ok, type Result, to_nullable } from "@f0rbit/corpus";

export const errors = {
	db: (e: unknown): DatabaseError => ({
		kind: "db_error" as const,
		message: format_error(e),
	}),
	missing: (resource: string): NotFoundError => ({
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
