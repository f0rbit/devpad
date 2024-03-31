/// <reference types="astro/client" />

interface User {
	id: string,
	github_id: number,
	name: string,
	email: string,
	email_verified: string | null,
	image_url: string | null
}

declare namespace App {
	interface Locals {
		user: User | null;
	}
}
