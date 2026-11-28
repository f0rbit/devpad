import type { R2Bucket } from "@cloudflare/workers-types";
import type { create_cloudflare_backend } from "@f0rbit/corpus";

type CorpusR2Bucket = Parameters<typeof create_cloudflare_backend>[0]["r2"];

// `@f0rbit/corpus`'s `create_cloudflare_backend` declares a narrow structural
// R2Bucket (`put` resolves void; `Headers`/`ReadableStream` from the global
// lib). This package loads BOTH workers-types and bun-types globals, so the
// runtime binding (workers-types' `Headers`, `R2Object | null` from `put`) is
// not assignable to it even though the runtime behaviour is identical (corpus
// ignores `put`'s return value). One bridge cast, here.
export const corpus_r2 = (bucket: R2Bucket): CorpusR2Bucket =>
	// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- workers-types vs bun-types global duplication (see comment above); runtime-identical.
	bucket as unknown as CorpusR2Bucket;
