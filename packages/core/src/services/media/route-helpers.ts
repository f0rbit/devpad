import type { AuthUser } from "@devpad/schema/bindings";
import type { ServiceError as SchemaServiceError } from "@devpad/schema/errors";
import type { AppContext } from "./context";

export {
	errorMap,
	handleResult,
	handleResultNoContent,
	handleResultWith,
	mapErrorToResponse as mapServiceErrorToResponse,
	response,
	valid,
} from "@devpad/worker/utils/response";

type MediaContextGetter = { get(key: "mediaContext"): AppContext | undefined };

export const getContext = (c: MediaContextGetter): AppContext => {
	const ctx = c.get("mediaContext");
	if (!ctx) throw new Error("AppContext not set");
	return ctx;
};

export type Variables = {
	user: AuthUser;
	mediaContext: AppContext;
};

export type ServiceError = SchemaServiceError;
