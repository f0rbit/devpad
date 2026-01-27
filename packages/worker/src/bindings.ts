import type { AppContext as BlogAppContext } from "@devpad/blog-server/context";
import type { SessionData } from "@devpad/core/auth";
import type { AppContext as MediaAppContext } from "@devpad/media-server/infrastructure/context";
import type { Bindings } from "@devpad/schema/bindings";
import type { UnifiedDatabase } from "@devpad/schema/database/d1";

export type AuthUser = {
	id: string;
	github_id: number;
	name: string;
	task_view: "list" | "grid";
} | null;

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
