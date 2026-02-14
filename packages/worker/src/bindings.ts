import type { SessionData } from "@devpad/core/auth";
import type { AppContext as BlogAppContext } from "@devpad/core/services/blog";
import type { AppContext as MediaAppContext } from "@devpad/core/services/media";
import type { AuthUser, Bindings } from "@devpad/schema/bindings";
import type { Database } from "@devpad/schema/database/types";

export type { AuthUser };

export type AppConfig = {
	environment: string;
	api_url: string;
	frontend_url: string;
	jwt_secret: string;
	encryption_key: string;
};

export type OAuthSecrets = {
	github_client_id: string;
	github_client_secret: string;
	reddit_client_id: string;
	reddit_client_secret: string;
	twitter_client_id: string;
	twitter_client_secret: string;
};

export type AppVariables = {
	db: Database;
	user: AuthUser;
	session: SessionData | null;
	blogContext: BlogAppContext;
	mediaContext: MediaAppContext;
	config: AppConfig;
	oauth_secrets: OAuthSecrets;
};

export type AppContext = {
	Bindings: Bindings;
	Variables: AppVariables;
};

export type { Bindings, Database };
