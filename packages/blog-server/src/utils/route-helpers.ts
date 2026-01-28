import type { AuthUser } from "@devpad/schema/bindings";
import { errorMap, response, valid } from "@devpad/worker/utils/response";
import type { AppContext } from "../context";

export { errorMap, response, valid };

export type Variables = {
	user: AuthUser;
	blogContext: AppContext;
};
