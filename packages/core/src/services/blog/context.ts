import { type Backend, create_corpus, type DrizzleDB, type PostsCorpus, postsStoreDefinition } from "@devpad/schema/blog";

export type AppContext = {
	db: DrizzleDB;
	corpus: PostsCorpus;
	jwt_secret: string;
	environment: string;
};

type CreateContextDeps = {
	db: DrizzleDB;
	backend: Backend;
	jwt_secret: string;
	environment: string;
};

export const createContext = (deps: CreateContextDeps): AppContext => {
	const corpus = create_corpus().with_backend(deps.backend).with_store(postsStoreDefinition).build();
	return {
		db: deps.db,
		corpus,
		jwt_secret: deps.jwt_secret,
		environment: deps.environment,
	};
};
