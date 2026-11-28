/// <reference path="../.astro/types.d.ts" />

import type { AuthUser } from "@devpad/schema/bindings";

declare global {
	namespace App {
		interface Locals {
			user: AuthUser;
			session: { id: string } | null;
			history: string[];
		}
	}
}
