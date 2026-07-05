import type { SessionData } from "@devpad/core/auth";
import type { AppContext as BlogAppContext } from "@devpad/core/services/blog";
import type { AppContext as MediaAppContext } from "@devpad/core/services/media";
import type { Pulse } from "@f0rbit/pulse-client";
import type { PulseLog } from "./lib/log.js";
import type { AuthUser, Bindings } from "@devpad/schema/bindings";
import type { Database } from "@devpad/schema/database/types";

export type { AuthUser };

export type AppConfig = {
	environment: string;
	api_url: string;
	frontend_url: string;
	jwt_secret: string;
	encryption_key: string;
	pulse_api_base?: string;
	pulse_internal_key?: string;
	pulse_devpad_ingest_key?: string;
	devpad_project_id?: string;
	git_sha?: string;
};

export type OAuthSecrets = {
	github_client_id: string;
	github_client_secret: string;
	reddit_client_id: string;
	reddit_client_secret: string;
	twitter_client_id: string;
	twitter_client_secret: string;
};

export type AuthChannel = "user" | "api";

export type AppVariables = {
	db: Database;
	user: AuthUser;
	session: SessionData | null;
	auth_channel: AuthChannel;
	api_key_scope: string | null;
	// Optional: `unifiedContextMiddleware` skips setting these when the
	// required Cloudflare bindings (DB/BLOG_CORPUS_BUCKET/MEDIA_CORPUS_BUCKET)
	// aren't configured — consumers must check for undefined rather than
	// assume these are always populated.
	blogContext?: BlogAppContext;
	mediaContext?: MediaAppContext;
	config: AppConfig;
	oauth_secrets: OAuthSecrets;
	pulse?: Pulse;
	// Optional like `pulse` above: the same middleware wires both up, and test
	// harnesses that don't install it must see `undefined`, not a lying
	// non-optional type -- callers use `c.get("log")?.warning(...)` etc.
	log?: PulseLog;
};

export type AppContext = {
	Bindings: Bindings;
	Variables: AppVariables;
};

export type { Bindings, Database };
