import { ApiClient } from './utils/request';
import { ProjectsClient } from './clients/projects';
import { TasksClient } from './clients/tasks';
import { TagsClient } from './clients/tags';
import { AuthClient } from './clients/auth';
import { ProjectOperationsClient } from './clients/project-operations';
import { TodoOperationsClient } from './clients/todo-operations';

export class DevpadApiClient {
  private api_client: ApiClient;
  private _api_key: string;
  public projects: ProjectsClient;
  public tasks: TasksClient;
  public tags: TagsClient;
  public auth: AuthClient;
  public projectOps: ProjectOperationsClient;
  public todoOps: TodoOperationsClient;

  constructor(options: { 
    base_url?: string; 
    api_key: string;
    max_history_size?: number;
  }) {
    const v0_base_url = options.base_url || 'http://localhost:4321/api/v0';
    const api_base_url = options.base_url ? options.base_url.replace('/v0', '') : 'http://localhost:4321/api';
    
    this._api_key = options.api_key;
    this.api_client = new ApiClient({
      base_url: v0_base_url,
      api_key: options.api_key,
      max_history_size: options.max_history_size
    });

    // Create separate client for non-v0 endpoints
    const general_api_client = new ApiClient({
      base_url: api_base_url,
      api_key: options.api_key,
      max_history_size: options.max_history_size
    });

    this.projects = new ProjectsClient(this.api_client);
    this.tasks = new TasksClient(this.api_client);
    this.tags = new TagsClient(this.api_client);
    this.auth = new AuthClient(this.api_client);
    this.projectOps = new ProjectOperationsClient(general_api_client);
    this.todoOps = new TodoOperationsClient(general_api_client);
  }

  public history() {
    return this.api_client.history();
  }

  public getApiKey(): string {
    return this._api_key;
  }
}

// Export types that users might need
export type { RequestHistoryEntry, RequestOptions } from './utils/request';
export type { ApiError as DevpadApiError, NetworkError, AuthenticationError, ValidationError } from './utils/errors';
export type { ProjectConfig, SaveConfigRequest, UpsertProjectRequest } from './clients/project-operations';
export type { TodoTag, UpsertTodoRequest } from './clients/todo-operations';

export default DevpadApiClient;