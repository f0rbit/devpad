/**
 * @module pipelines/corpus-backend
 *
 * Creates a corpus backend for the CLI. In local dev/CI, uses in-memory backend.
 * Can be extended to support Cloudflare D1+R2 for production.
 */

import type { Backend } from "@f0rbit/corpus";
import { create_memory_backend } from "@f0rbit/corpus";

export async function createCorpusBackend(): Promise<Backend> {
	// For Phase 1 / CI: always use in-memory backend
	// Phase 2 can introduce environment-based selection for Cloudflare
	return create_memory_backend();
}
