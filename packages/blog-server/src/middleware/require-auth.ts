import type { Context, Input } from "hono";
import type { AppContext } from "../context";

type AuthUser = {
	id: string;
	github_id: number;
	name: string;
	task_view: "list" | "grid";
};

type AuthenticatedHandler<P extends string, I extends Input, T> = (c: Context<any, P, I>, user: AuthUser, ctx: AppContext) => Promise<T>;

export const withAuth =
	<P extends string, I extends Input, T>(handler: AuthenticatedHandler<P, I, T>) =>
	async (c: Context<any, P, I>): Promise<T | Response> => {
		const user = c.get("user");
		const ctx = c.get("blogContext");

		if (!user) {
			return c.json({ code: "UNAUTHORIZED", message: "Authentication required" }, 401);
		}
		if (!ctx) {
			return c.json({ code: "INTERNAL_ERROR", message: "Blog context not initialized" }, 500);
		}
		return handler(c, user, ctx);
	};
