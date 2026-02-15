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
} from "@devpad/schema/types";
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
} from "@devpad/schema/blog/types";
export type { VersionInfo } from "@devpad/schema/blog/corpus";
export type {
  Account,
  AddFilterInput,
  CreateProfileInput,
  Profile,
  ProfileFilter,
  UpdateProfileInput,
} from "@devpad/schema/media/types";
export type { PlatformSettings } from "@devpad/schema/media/settings";
export type { Timeline } from "@devpad/schema/media/timeline";
export type { AuthMode } from "./api-client";
export { getUserFriendlyErrorMessage, parseZodErrors } from "./error-handlers";
export type {
  ApiError,
  AuthenticationError,
  NetworkError,
  ValidationError,
} from "./errors";
export type { RequestHistoryEntry, RequestOptions } from "./request";
export {
  type ApiResult,
  type ApiResultError,
  err,
  ok,
  type Result,
  wrap,
} from "./result";
export { getTool, type ToolDefinition, toolNames, tools } from "./tools";
export { ApiClient };
export default ApiClient;
