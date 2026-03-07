import { type Column, inArray, type SQL } from "drizzle-orm";

// D1 (Cloudflare SQLite) hard limit: 100 bound parameters per query
export const D1_PARAM_LIMIT = 99;

export async function batchedQuery<TRow>(values: any[], queryFn: (condition: SQL) => Promise<TRow[]>, column: Column): Promise<TRow[]> {
	if (values.length === 0) return [];
	if (values.length <= D1_PARAM_LIMIT) return queryFn(inArray(column, values));

	const results: TRow[] = [];
	for (let i = 0; i < values.length; i += D1_PARAM_LIMIT) {
		const chunk = values.slice(i, i + D1_PARAM_LIMIT);
		const batch = await queryFn(inArray(column, chunk));
		results.push(...batch);
	}
	return results;
}
