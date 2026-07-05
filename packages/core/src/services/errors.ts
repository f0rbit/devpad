import { err, first, match, ok, type Result, to_nullable } from "@f0rbit/corpus";

export * from "@devpad/schema/errors";

export const rows = {
	firstOr: <T, E>(list: T[], errorFn: () => E): Result<T, E> =>
		match(
			first(list),
			(v: T) => ok(v) as Result<T, E>,
			() => err(errorFn()),
		),
	first: <T>(list: T[]): T | null => to_nullable(first(list)),
};
