import type { SessionData } from "@devpad/core/auth";
import type { AppContext as BlogAppContext } from "@devpad/core/services/blog";
import type { AppContext as MediaAppContext } from "@devpad/core/services/media";
import type { AuthUser, Bindings } from "@devpad/schema/bindings";
import type { UnifiedDatabase } from "@devpad/schema/database/d1";

export type { AuthUser };

export type AppVariables = {
	db: UnifiedDatabase;
	user: AuthUser;
	session: SessionData | null;
	blogContext: BlogAppContext;
	mediaContext: MediaAppContext;
};

export type AppContext = {
	Bindings: Bindings;
	Variables: AppVariables;
};

export type { Bindings, UnifiedDatabase };
