import { Hono } from "hono";
import type { AppContext, Bindings } from "./bindings.js";
import { authMiddleware } from "./middleware/auth.js";
import { dbMiddleware } from "./middleware/db.js";
import authRoutes from "./routes/auth.js";
import v0Routes from "./routes/v0.js";

const app = new Hono<AppContext>();

app.get("/health", c => c.json({ status: "ok" }));

app.use("/api/*", dbMiddleware);
app.use("/api/*", authMiddleware);

app.route("/api/v0", v0Routes);
app.route("/api/auth", authRoutes);

app.all("*", c => {
	const host = c.req.header("host") || new URL(c.req.url).host;

	if (host.includes("blog.devpad.tools")) {
		return c.json({ message: "Blog frontend — coming in Phase 2" }, 501);
	}
	if (host.includes("media.devpad.tools")) {
		return c.json({ message: "Media timeline frontend — coming in Phase 2" }, 501);
	}

	return c.json({ message: "devpad — Cloudflare Worker", version: "1.0.0" });
});

const scheduled: ExportedHandler<Bindings>["scheduled"] = async (event, _env, _ctx) => {
	console.log("Cron triggered:", event.cron);
};

export default {
	fetch: app.fetch,
	scheduled,
};
