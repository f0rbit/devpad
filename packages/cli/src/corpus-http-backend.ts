/**
 * @module @devpad/cli/corpus-http-backend
 *
 * Implements the corpus `Backend` interface by forwarding writes to a
 * remote orchestrator's `/artifacts/*` HTTP routes. The CLI only ever
 * writes — `data.put`, `metadata.put` (via the version-set manifest
 * route), and an in-memory shadow for reads so the corpus
 * `version_set_store` factory's local pre-read paths don't fail.
 *
 * Side effects: every `data.put` POSTs to `POST /artifacts/blob`; every
 * `metadata.put` either rides along with a manifest upload (when the
 * meta points at the `version-sets` store) or is shadowed locally so
 * the corpus internals stay consistent.
 *
 * Hook for Task 5.D: callers needing to upload arbitrary blobs to a
 * named store (e.g. a compiled template snapshot) can use
 * {@link upload_blob_to_store}. It returns the `{ store_id, ref,
 * content_hash, version }` envelope the manifest builder needs without
 * going through the version-set wire.
 *
 * Read-only Backend ops (`get`, `list`, `delete`) delegate to a local
 * `create_memory_backend()` so the CLI's existing manifest build paths
 * keep working without hitting the network.
 */

import {
	type Backend,
	type BatchOp,
	create_memory_backend,
	type CorpusError,
	err,
	ok,
	type Result,
	type SnapshotMeta,
	type VersionSetManifest,
} from "@f0rbit/corpus";

export type CorpusHttpBackendInput = {
	pipelines_url: string;
	pipelines_token: string;
};

export type CorpusHttpUploadError =
	| { kind: "http"; status: number; status_text: string }
	| { kind: "network"; cause: unknown }
	| { kind: "decode"; message: string };

export type BlobUploadResult = {
	version: string;
	content_hash: string;
	store_id: string;
	ref: string;
};

export type ManifestUploadResult = {
	version_set_id: string;
	content_hash: string;
	package: string;
};

const trim_url = (url: string): string => (url.endsWith("/") ? url.slice(0, -1) : url);

const bearer = (token: string): string => `Bearer ${token}`;

type PostBody = string | Uint8Array | Buffer;
type PostInput = { url: string; headers: Record<string, string>; body: PostBody };

const post_envelope = async <T>(input: PostInput): Promise<Result<T, CorpusHttpUploadError>> => {
	let response: Response;
	try {
		response = await fetch(input.url, {
			method: "POST",
			headers: input.headers,
			body: input.body as unknown as ArrayBuffer | string,
		});
	} catch (cause) {
		return err<CorpusHttpUploadError>({ kind: "network", cause });
	}
	if (!response.ok) {
		return err<CorpusHttpUploadError>({ kind: "http", status: response.status, status_text: response.statusText });
	}
	const body = (await response.json().catch(() => null)) as { ok?: boolean; value?: T; error?: unknown } | null;
	if (body === null || body.ok !== true || body.value === undefined) {
		return err<CorpusHttpUploadError>({ kind: "decode", message: "unexpected response envelope" });
	}
	return ok(body.value);
};

/**
 * Upload an arbitrary blob to a named corpus store via the
 * orchestrator's `POST /artifacts/blob`. Returns the assigned version +
 * the `<store_id>/<content_hash>` ref the manifest builder uses.
 *
 * Exposed as a top-level helper (not just `Backend.data.put`) so callers
 * that don't want to thread a full Backend can upload single blobs
 * directly — Task 5.D consumes this hook for compiled-template
 * snapshots.
 */
export const upload_blob_to_store = async (
	input: CorpusHttpBackendInput,
	store_id: string,
	bytes: Uint8Array,
): Promise<Result<BlobUploadResult, CorpusHttpUploadError>> =>
	post_envelope<BlobUploadResult>({
		url: `${trim_url(input.pipelines_url)}/artifacts/blob`,
		headers: {
			authorization: bearer(input.pipelines_token),
			"content-type": "application/octet-stream",
			"x-store-id": store_id,
		},
		body: bytes,
	});

/**
 * Upload a {@link VersionSetManifest} to the orchestrator's
 * `POST /artifacts/version-set`. Returns the corpus-assigned
 * `version_set_id`.
 */
export const upload_version_set = async (
	input: CorpusHttpBackendInput,
	manifest: VersionSetManifest,
): Promise<Result<ManifestUploadResult, CorpusHttpUploadError>> =>
	post_envelope<ManifestUploadResult>({
		url: `${trim_url(input.pipelines_url)}/artifacts/version-set`,
		headers: {
			authorization: bearer(input.pipelines_token),
			"content-type": "application/json",
		},
		body: JSON.stringify(manifest),
	});

/**
 * Build a corpus `Backend` whose writes are forwarded to the remote
 * orchestrator. Reads + non-version-set metadata stay in a local
 * in-memory shadow so the corpus internals (content-hash dedup checks,
 * `version_set_store` pre-reads) keep working.
 *
 * Behaviour:
 * - `data.put(key, bytes)` — forwarded to `POST /artifacts/blob` with
 *   the store_id parsed from `key` (`<store_id>/<content_hash>`). The
 *   result is also shadowed locally for read-back.
 * - `metadata.put(meta)` — when `meta.store_id === "version-sets"`,
 *   buffer the meta and wait for the next pending manifest body to be
 *   sent via `apply_batch`. Otherwise shadow locally.
 * - `apply_batch(ops)` — translates a version-set transaction into a
 *   single `POST /artifacts/version-set` call. Other batched ops are
 *   replayed against the shadow.
 *
 * The cleanest path the CLI exercises is: `version_set_store(backend)
 * .put(manifest)` → calls `backend.data.put` (blob for the manifest
 * JSON) → calls `backend.metadata.put` (the snapshot meta). We
 * intercept both: `data.put` becomes a `metadata.put` short-circuit
 * (the manifest body is JSON; we hold onto it), and `metadata.put`
 * then issues the single `/artifacts/version-set` call.
 */
export const create_corpus_http_backend = (input: CorpusHttpBackendInput): Backend => {
	const shadow = create_memory_backend();

	// Buffer the last `data.put` body keyed by data_key. The corpus call
	// sequence is `data.put(key, bytes)` then `metadata.put(meta)`, so
	// the metadata handler retrieves the bytes by `meta.data_key` and
	// dispatches the right wire call: `version_set_put` if the body
	// parses as a `VersionSetManifest`, otherwise a plain `blob_put`.
	const pending_bytes = new Map<string, Uint8Array>();

	const flush_meta = async (meta: SnapshotMeta): Promise<Result<void, CorpusError>> => {
		const bytes = pending_bytes.get(meta.data_key);
		if (bytes === undefined) {
			// Probably a meta-only write (promote, dedup hit). Persist locally
			// for read-back; the server already has the data from the
			// originating put.
			return shadow.metadata.put(meta);
		}
		pending_bytes.delete(meta.data_key);

		if (meta.store_id === "version-sets") {
			const parsed = safe_parse_json(new TextDecoder().decode(bytes));
			if (parsed === null)
				return err<CorpusError>({ kind: "decode_error", cause: new Error("manifest body is not valid JSON") });
			const upload = await upload_version_set(input, parsed as VersionSetManifest);
			if (!upload.ok) return err<CorpusError>(translate_http_error(upload.error, "version_set_put"));
			// Rewrite local shadow meta with the remote-assigned identifiers
			// so callers reading back `meta.version` see the server's value.
			const remote_meta: SnapshotMeta = {
				...meta,
				version: upload.value.version_set_id,
				content_hash: upload.value.content_hash,
			};
			// Remote upload already succeeded; a failed local shadow write only
			// degrades read-back consistency for this process, not correctness
			// of the remote store, so we log and continue rather than fail.
			const shadow_write = await shadow.data.put(meta.data_key, bytes);
			if (!shadow_write.ok)
				console.warn(`corpus-http-backend: shadow data write failed for ${meta.data_key}`, shadow_write.error);
			return shadow.metadata.put(remote_meta);
		}

		const upload = await upload_blob_to_store(input, meta.store_id, bytes);
		if (!upload.ok) return err<CorpusError>(translate_http_error(upload.error, "blob_put"));
		const remote_meta: SnapshotMeta = {
			...meta,
			version: upload.value.version,
			content_hash: upload.value.content_hash,
		};
		const shadow_write = await shadow.data.put(meta.data_key, bytes);
		if (!shadow_write.ok)
			console.warn(`corpus-http-backend: shadow data write failed for ${meta.data_key}`, shadow_write.error);
		return shadow.metadata.put(remote_meta);
	};

	return {
		on_event: shadow.on_event,
		metadata: {
			get: shadow.metadata.get,
			delete: shadow.metadata.delete,
			list: shadow.metadata.list,
			get_latest: shadow.metadata.get_latest,
			get_children: shadow.metadata.get_children,
			find_by_hash: shadow.metadata.find_by_hash,
			put: flush_meta,
		},
		data: {
			get: shadow.data.get,
			delete: shadow.data.delete,
			exists: shadow.data.exists,
			put: async (
				data_key: string,
				data: ReadableStream<Uint8Array> | Uint8Array,
			): Promise<Result<void, CorpusError>> => {
				const bytes = await to_bytes(data);
				// Buffer until metadata.put fires the wire call. We have to
				// wait because we don't know if this is a version-set write
				// (metadata.store_id === "version-sets") or a plain blob —
				// the data_key alone isn't enough to disambiguate.
				pending_bytes.set(data_key, bytes);
				return ok(undefined);
			},
		},
		apply_batch: async (ops: BatchOp[]): Promise<Result<void, CorpusError>> => {
			// Replay sequentially through our adapted clients so the same
			// buffer-then-flush semantics apply.
			for (const op of ops) {
				if (op.type === "data_put") {
					pending_bytes.set(op.data_key, op.bytes);
					continue;
				}
				if (op.type === "meta_put") {
					const r = await flush_meta(op.meta);
					if (!r.ok) return r;
					continue;
				}
				if (op.type === "meta_delete") {
					const r = await shadow.metadata.delete(op.store_id, op.version);
					if (!r.ok) return r;
					continue;
				}
				if (shadow.apply_batch !== undefined) {
					const r = await shadow.apply_batch([op]);
					if (!r.ok) return r;
				}
			}
			return ok(undefined);
		},
	};
};

const safe_parse_json = (text: string): unknown => {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
};

const to_bytes = async (data: ReadableStream<Uint8Array> | Uint8Array): Promise<Uint8Array> => {
	if (data instanceof Uint8Array) return data;
	const reader = data.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		total += value.byteLength;
	}
	const out = new Uint8Array(total);
	let off = 0;
	for (const c of chunks) {
		out.set(c, off);
		off += c.byteLength;
	}
	return out;
};

const translate_http_error = (e: CorpusHttpUploadError, operation: string): CorpusError => {
	const message =
		e.kind === "http"
			? `HTTP ${String(e.status)} ${e.status_text}`
			: e.kind === "network"
				? `network error: ${String(e.cause)}`
				: `decode error: ${e.message}`;
	return { kind: "storage_error", cause: new Error(message), operation };
};
