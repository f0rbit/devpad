// `@f0rbit/corpus`'s `create_cloudflare_backend` declares a narrow structural
// R2Bucket whose `put` resolves void; the runtime binding's `put` resolves
// `R2Object | null`, so the raw binding is not assignable. This adapter keeps
// the call semantics and discards the result object (same shape as
// `packages/worker/src/corpus-r2.ts` — the type system, not a cast, bridges
// the two).
export const corpus_r2 = (bucket: R2Bucket) => ({
	get: (key: string) => bucket.get(key),
	put: async (key: string, data: ReadableStream<Uint8Array> | Uint8Array) => {
		await bucket.put(key, data);
	},
	delete: (key: string) => bucket.delete(key),
	head: (key: string) => bucket.head(key),
});
