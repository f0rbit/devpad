import { configureErrorLogging, type ErrorLogEntry } from "@devpad/schema/media";

const serverErrorLogger = ({ error, context }: ErrorLogEntry) => {
	console.error(`[SSR] [${error.kind}] ${error.message || ""}`, {
		error,
		timestamp: context.timestamp,
	});
};

export const initializeServerErrorLogging = () => {
	configureErrorLogging({
		logger: serverErrorLogger,
		contextProvider: () => ({
			environment: "ssr",
		}),
	});
};
