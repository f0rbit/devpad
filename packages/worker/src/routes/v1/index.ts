import { Hono } from "hono";
import type { AppContext } from "../../bindings.js";
import goals from "./goals.js";
import keys from "./keys.js";
import milestones from "./milestones.js";
import projects from "./projects.js";
import scanning from "./scanning.js";
import tags from "./tags.js";
import tasks from "./tasks.js";
import user from "./user.js";

const app = new Hono<AppContext>();

app.get("/", c => c.json({ version: "1", status: "ok" }));

app.route("/projects", projects);
app.route("/tasks", tasks);
app.route("/milestones", milestones);
app.route("/goals", goals);
app.route("/keys", keys);
app.route("/user", user);
app.route("/tags", tags);

app.route("/projects", scanning);

app.route("/", projects);

app.route("/", user);

export default app;
