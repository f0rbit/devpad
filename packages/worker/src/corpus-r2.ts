// `@f0rbit/corpus`'s `create_cloudflare_backend` declares a narrow structural
// R2Bucket whose `put` resolves void. The runtime Workers binding's `put`
// resolves R2Object | null, which is NOT assignable to Promise<void> —
// passing the raw binding fails typecheck with "two different R2Bucket
// types". The adapter preserves the runtime call semantics and discards the
// result object; get/head/delete pass through structurally unchanged.
export const corpus_r2 = (bucket: R2Bucket) => ({
	get: (key: string) => bucket.get(key),
	put: async (key: string, data: ReadableStream<Uint8Array> | Uint8Array) => {
		await bucket.put(key, data);
	},
	delete: (key: string) => bucket.delete(key),
	head: (key: string) => bucket.head(key),
});
