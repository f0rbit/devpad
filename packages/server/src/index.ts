import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { authMiddleware } from "./middleware/auth";

// Import route modules
import authRoutes from "./routes/auth";
import v0Routes from "./routes/v0";
import keysRoutes from "./routes/keys";
import projectRoutes from "./routes/project";
import userRoutes from "./routes/user";

const app = new Hono();

// Global middleware
app.use("*", logger());

// CORS configuration
if (process.env.NODE_ENV === "test") {
	// Allow all origins for test environment
	app.use(
		"*",
		cors({
			origin: origin => origin || "*",
			credentials: true,
		})
	);
} else {
	// Production CORS settings
	app.use(
		"*",
		cors({
			origin: ["http://localhost:4321", "http://localhost:3000"],
			credentials: true,
		})
	);
}
app.use("*", authMiddleware);

// Health check
app.get("/health", c => c.json({ status: "ok", timestamp: new Date().toISOString() }));

// Routes
app.route("/api/auth", authRoutes);
app.route("/api/v0", v0Routes);
app.route("/api/keys", keysRoutes);
app.route("/api/project", projectRoutes);
app.route("/api/user", userRoutes);

const port = process.env.PORT || 3001;

console.log(`🚀 Server is running on port ${port}`);

export default {
	port,
	fetch: app.fetch,
};
