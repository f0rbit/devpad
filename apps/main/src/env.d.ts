/// <reference path="../.astro/types.d.ts" />

declare namespace App {
	interface Locals {
		user: import("@devpad/schema/bindings").AuthUser;
		session: { id: string } | null;
		history: string[];
	}
}
