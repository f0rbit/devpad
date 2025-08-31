import { ApiClient } from './utils/request';
import { ProjectsClient } from './clients/projects';
import { TasksClient } from './clients/tasks';
import { TagsClient } from './clients/tags';
import { AuthClient } from './clients/auth';

export class DevpadApiClient {
  private api_client: ApiClient;
  private _api_key: string;
  public projects: ProjectsClient;
  public tasks: TasksClient;
  public tags: TagsClient;
  public auth: AuthClient;

  constructor(options: { 
    base_url?: string; 
    api_key: string;
    max_history_size?: number;
  }) {
    const v0_base_url = options.base_url || 'http://localhost:4321/api/v0';
    
    this._api_key = options.api_key;
    this.api_client = new ApiClient({
      base_url: v0_base_url,
      api_key: options.api_key,
      max_history_size: options.max_history_size
    });

    this.projects = new ProjectsClient(this.api_client);
    this.tasks = new TasksClient(this.api_client);
    this.tags = new TagsClient(this.api_client);
    this.auth = new AuthClient(this.api_client);
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
export type { ApiError as ApiError, NetworkError, AuthenticationError, ValidationError } from './utils/errors';
export type { 
	Project, 
	UpsertProject, 
	SaveConfigRequest, 
	ProjectConfig,
	Task,
	UpsertTodo, 
	UpsertTag,
	TaskWithDetails 
} from '@devpad/schema';

export default DevpadApiClient;