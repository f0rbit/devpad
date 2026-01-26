import { Hono } from "hono";
import type { AppContext, Bindings } from "./bindings.js";

const app = new Hono<AppContext>();

app.get("/health", c => c.json({ status: "ok" }));

app.get("*", c => {
	const hostname = new URL(c.req.url).hostname;

	if (hostname === "blog.devpad.tools") return c.json({ app: "blog", status: "placeholder" });

	if (hostname === "media.devpad.tools") return c.json({ app: "media", status: "placeholder" });

	return c.json({ app: "devpad", status: "placeholder" });
});

app.all("*", c => c.json({ error: "not found" }, 404));

const scheduled: ExportedHandler<Bindings>["scheduled"] = async (_event, _env, _ctx) => {
	// media-timeline cron handler placeholder
};

export default {
	fetch: app.fetch,
	scheduled,
};
