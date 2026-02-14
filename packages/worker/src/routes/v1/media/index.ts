import { Hono } from "hono";
import type { AppContext } from "../../../bindings.js";
import { authRoutes } from "./auth.js";
import { connectionRoutes } from "./connections.js";
import { credentialRoutes } from "./credentials.js";
import { profileRoutes } from "./profiles.js";
import { timelineRoutes } from "./timeline.js";

const app = new Hono<AppContext>();

app.route("/timeline", timelineRoutes);
app.route("/connections", connectionRoutes);
app.route("/credentials", credentialRoutes);
app.route("/profiles", profileRoutes);

export { authRoutes };
export default app;
