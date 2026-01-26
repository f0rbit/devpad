import type { Bindings } from "@devpad/schema/bindings";
import type { Hono } from "hono";

export type { Bindings } from "@devpad/schema/bindings";

export type AppContext = {
	Bindings: Bindings;
};

export type App = Hono<AppContext>;
