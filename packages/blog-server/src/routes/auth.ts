import { Hono } from "hono";
import { deleteCookie } from "hono/cookie";
import type { Variables } from "../utils/route-helpers";

export const authRouter = new Hono<{ Variables: Variables }>();

authRouter.get("/status", c => {
	const user = c.get("user");

	return c.json({
		authenticated: !!user,
		user: user ?? null,
	});
});

authRouter.get("/logout", c => {
	deleteCookie(c, "session");
	deleteCookie(c, "devpad_session");
	deleteCookie(c, "devpad_jwt");

	return c.html(`
		<!DOCTYPE html>
		<html>
		<head><title>Logging out...</title></head>
		<body>
			<script>
				document.cookie = 'session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
				window.location.href = '/';
			</script>
		</body>
		</html>
	`);
});
