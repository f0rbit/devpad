import { Hono } from "hono";
import type { AppContext } from "../../../bindings.js";
import { categoriesRouter } from "./categories.js";
import { postsRouter } from "./posts.js";
import { tagsRouter } from "./tags.js";
import { tokensRouter } from "./tokens.js";

const app = new Hono<AppContext>();

app.route("/posts", postsRouter);
app.route("/tags", tagsRouter);
app.route("/categories", categoriesRouter);
app.route("/tokens", tokensRouter);

export default app;
