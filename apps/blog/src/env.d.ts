/// <reference types="astro/client" />

declare namespace App {
	interface Locals {
		user: import("@devpad/schema/bindings").AuthUser;
		session: { id: string } | null;
		jwtToken: string | null;
	}
}
