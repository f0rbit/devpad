// Main exports for @devpad/media-server package

import { configureErrorLogging } from "@devpad/schema/media";
import { createLogger } from "./logger";

const errorLog = createLogger("errors");

// Configure error logging with a custom logger.
// Note: Request context (requestId, userId, path) should be passed explicitly
// via the ctx parameter when calling error functions, as we no longer use
// AsyncLocalStorage for automatic context propagation.
configureErrorLogging({
	logger: ({ error, context }) => {
		errorLog.error(`[${error.kind}] ${error.message || ""}`, {
			error_kind: error.kind,
			...error,
			request_id: context.requestId,
			user_id: context.userId,
			operation: context.operation,
			path: context.path,
			timestamp: context.timestamp,
			stack: context.stack?.split("\n").slice(2, 6).join("\n"),
		});
	},
	// No contextProvider - pass context explicitly when calling error functions
});

export {
	type AuthContext,
	authMiddleware,
	getAuth,
	optionalAuthMiddleware,
} from "./auth";
export { type Bindings, createContextFromBindings } from "./bindings";
export { type CronResult, handleCron, type ProviderFactory as CronProviderFactory } from "./cron";
export { createDb, type Database } from "./db";
export type { AppContext } from "./infrastructure/context";
export { createProviderFactory, defaultProviderFactory } from "./platforms";
export type { ProviderFactory } from "./platforms/types";
// Rate limiting
export {
	initialState,
	isCircuitOpen,
	type RateLimitState,
	shouldFetch,
	updateOnFailure,
	updateOnSuccess,
} from "./rate-limits";
// Request context
export {
	generateRequestId,
	getRequestContext,
	type RequestContext,
	requestContextMiddleware,
	setRequestUserId,
} from "./request-context";
export { authRoutes, connectionRoutes, profileRoutes, timelineRoutes, token } from "./routes/index";

// Services
export * from "./services";
export { secrets } from "./utils";
// Route helpers
export { handleResult, handleResultNoContent, handleResultWith, type ServiceError, type Variables } from "./utils/route-helpers";
