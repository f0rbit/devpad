import { err, mapCorpusError, ok, type PostContent, type PostCorpusError, type PostsCorpus, postsStoreDefinition, type Result, type VersionInfo } from "@devpad/schema/blog";
import { type Backend, create_store } from "@f0rbit/corpus";

const corpusToBackend = (corpus: PostsCorpus): Backend => {
	const backend: Backend = {
		metadata: corpus.metadata,
		data: corpus.data,
	};
	if (corpus.observations) {
		backend.observations = corpus.observations;
	}
	return backend;
};

const createDynamicStore = (corpus: PostsCorpus, storeId: string) => create_store(corpusToBackend(corpus), { ...postsStoreDefinition, id: storeId });

const put = async (corpus: PostsCorpus, path: string, content: PostContent, parent?: string): Promise<Result<{ hash: string }, PostCorpusError>> => {
	const store = createDynamicStore(corpus, path);

	const opts = parent ? { parents: [{ store_id: path, version: parent }] } : {};
	const result = await store.put(content, opts);

	if (!result.ok) return err(mapCorpusError(result.error));

	return ok({ hash: result.value.version });
};

const get = async (corpus: PostsCorpus, path: string, hash: string): Promise<Result<PostContent, PostCorpusError>> => {
	const store = createDynamicStore(corpus, path);

	const result = await store.get(hash);

	if (!result.ok) return err(mapCorpusError(result.error));

	return ok(result.value.data);
};

const versions = async (corpus: PostsCorpus, path: string): Promise<Result<VersionInfo[], PostCorpusError>> => {
	const store = createDynamicStore(corpus, path);

	const versionList: VersionInfo[] = [];

	for await (const meta of store.list()) {
		const firstParent = meta.parents[0];
		versionList.push({
			hash: meta.version,
			parent: firstParent?.version ?? null,
			created_at: meta.created_at,
		});
	}

	versionList.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());

	return ok(versionList);
};

const remove = async (corpus: PostsCorpus, path: string): Promise<Result<void, PostCorpusError>> => {
	const store = createDynamicStore(corpus, path);

	for await (const meta of store.list()) {
		const result = await store.delete(meta.version);
		if (!result.ok) return err(mapCorpusError(result.error));
	}

	return ok(undefined);
};

export const corpus = {
	put,
	get,
	versions,
	delete: remove,
};
