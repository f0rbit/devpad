import { ApiClient } from "./api-client";

export type {
	Project,
	ProjectConfig,
	SaveConfigRequest,
	Task,
	TaskWithDetails,
	UpsertProject,
	UpsertTag,
	UpsertTodo,
} from "@devpad/schema";
export { getUserFriendlyErrorMessage, parseZodErrors } from "./error-handlers";
export type { ApiError, AuthenticationError, NetworkError, ValidationError } from "./errors";
export type { RequestHistoryEntry, RequestOptions } from "./request";
export default ApiClient;
