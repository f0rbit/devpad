import type { Backend } from "@f0rbit/corpus/cloudflare";
import type { AppContext, DrizzleDB, OAuthEnvCredentials } from "./context";
import type { ProviderFactory } from "./platforms/types";

export type CreateContextDeps = {
	db: DrizzleDB;
	backend: Backend;
	providerFactory: ProviderFactory;
	encryptionKey: string;
	env?: OAuthEnvCredentials;
};

export const createContext = (deps: CreateContextDeps): AppContext => ({
	db: deps.db,
	backend: deps.backend,
	providerFactory: deps.providerFactory,
	encryptionKey: deps.encryptionKey,
	env: deps.env,
});
