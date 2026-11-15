export type MergeByKeyOptions = {
	// "existing" (default): first-seen version wins on key collision (append-only
	// stores, e.g. commits by sha). "incoming": re-fetched items replace their
	// stored copy (mutable items, e.g. PRs whose state/title/commits changed).
	prefer?: "existing" | "incoming";
};

export const mergeByKey = <T>(
	existing: T[] | null | undefined,
	incoming: T[],
	getKey: (item: T) => string,
	options: MergeByKeyOptions = {},
): { merged: T[]; newCount: number } => {
	if (!existing || existing.length === 0) {
		return { merged: incoming, newCount: incoming.length };
	}

	if (options.prefer === "incoming") {
		const incomingByKey = new Map(incoming.map((item) => [getKey(item), item] as const));
		const merged = existing.map((item) => incomingByKey.get(getKey(item)) ?? item);
		const existingKeys = new Set(existing.map(getKey));
		const newItems = incoming.filter((item) => !existingKeys.has(getKey(item)));
		return {
			merged: [...merged, ...newItems],
			newCount: newItems.length,
		};
	}

	const existingKeys = new Set(existing.map(getKey));
	const newItems = incoming.filter((item) => !existingKeys.has(getKey(item)));

	return {
		merged: [...existing, ...newItems],
		newCount: newItems.length,
	};
};
