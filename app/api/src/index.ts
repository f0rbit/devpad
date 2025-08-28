import { ApiClient } from './utils/request';
import { ProjectsClient } from './clients/projects';
import { TasksClient } from './clients/tasks';
import { TagsClient } from './clients/tags';
import { AuthClient } from './clients/auth';

export class DevpadApiClient {
  private api_client: ApiClient;
  public projects: ProjectsClient;
  public tasks: TasksClient;
  public tags: TagsClient;
  public auth: AuthClient;

  constructor(options: { 
    base_url?: string; 
    api_key: string 
  }) {
    const base_url = options.base_url || 'http://localhost:4321/api/v0';
    
    this.api_client = new ApiClient({
      base_url,
      api_key: options.api_key
    });

    this.projects = new ProjectsClient(this.api_client);
    this.tasks = new TasksClient(this.api_client);
    this.tags = new TagsClient(this.api_client);
    this.auth = new AuthClient(this.api_client);
  }
}

export default DevpadApiClient;