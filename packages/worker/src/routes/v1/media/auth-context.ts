import type { Context } from "hono";

export type AuthContext = {
	user_id: string;
	name: string | null;
	email: string | null;
	image_url: string | null;
};

export const getAuth = (c: Context): AuthContext => {
	const user = c.get("user");
	if (!user) {
		throw new Error("Auth context not found. Ensure the worker auth middleware has run.");
	}
	return {
		user_id: user.id,
		name: user.name,
		email: null,
		image_url: null,
	};
};

export const getContext = (c: Context) => {
	const ctx = c.get("mediaContext");
	if (!ctx) {
		throw new Error("Media context not found. Ensure the unified context middleware has run.");
	}
	return ctx;
};
