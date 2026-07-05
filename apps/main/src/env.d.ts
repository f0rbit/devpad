/// <reference path="../.astro/types.d.ts" />

import type { AuthUser } from "@devpad/schema/bindings";

declare namespace App {
	interface Locals {
		user: AuthUser;
		session: { id: string } | null;
		history: string[];
	}
}
