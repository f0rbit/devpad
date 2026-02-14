/// <reference types="astro/client" />

interface ImportMetaEnv {
	readonly PUBLIC_API_URL: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}

declare namespace App {
	interface Locals {
		user: import("@devpad/schema/bindings").AuthUser;
		session: { id: string } | null;
		jwtToken: string | null;
	}
}
