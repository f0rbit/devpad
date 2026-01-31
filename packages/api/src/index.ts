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
export type {
	AccessKey,
	Category,
	CategoryCreate,
	Post,
	PostContent,
	PostCreate,
	PostListParams,
	PostsResponse,
	PostUpdate,
	VersionInfo,
} from "@devpad/schema/blog";
export type {
	Account,
	AddFilterInput,
	CreateProfileInput,
	PlatformSettings,
	Profile,
	ProfileFilter,
	Timeline,
	UpdateProfileInput,
} from "@devpad/schema/media";
export type { AuthMode } from "./api-client";
export { getUserFriendlyErrorMessage, parseZodErrors } from "./error-handlers";
export type { ApiError, AuthenticationError, NetworkError, ValidationError } from "./errors";
export type { RequestHistoryEntry, RequestOptions } from "./request";
export { type ApiResult, type ApiResultError, err, ok, type Result, wrap } from "./result";
export { getTool, type ToolDefinition, toolNames, tools } from "./tools";
export { ApiClient };
export default ApiClient;
