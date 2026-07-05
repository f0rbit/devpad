/// <reference types="astro/client" />

import type { AuthUser } from "@devpad/schema/bindings";

declare global {
	interface ImportMetaEnv {
		readonly PUBLIC_API_URL: string;
	}

	interface ImportMeta {
		readonly env: ImportMetaEnv;
	}

	namespace App {
		interface Locals {
			user: AuthUser;
			session: { id: string } | null;
		}
	}
}
