import type { TaskWithDetails, UpsertTodo, UpsertTag } from '@devpad/schema';
import { ApiClient } from '@/utils/request';

export class TasksClient {
  private api_client: ApiClient;

  constructor(api_client: ApiClient) {
    this.api_client = api_client;
  }

  async list(options: { 
    project_id?: string;
    tag_id?: string;
  } = {}) {
    const query: Record<string, string> = {};
    
    if (options.project_id) {
      query.project = options.project_id;
    }
    if (options.tag_id) {
      query.tag = options.tag_id;
    }
    
    return this.api_client.get<TaskWithDetails[]>('/tasks', 
      Object.keys(query).length > 0 ? { query } : {}
    );
  }

  async get(id: string) {
    // GET /tasks?id=<task_id>
    return this.api_client.get<TaskWithDetails>('/tasks', {
      query: { id }
    });
  }

  async getByProject(project_id: string) {
    // GET /tasks?project=<project_id>
    return this.api_client.get<TaskWithDetails[]>('/tasks', {
      query: { project: project_id }
    });
  }

  async getByTag(tag_id: string) {
    // GET /tasks?tag=<tag_id>
    return this.api_client.get<TaskWithDetails[]>('/tasks', {
      query: { tag: tag_id }
    });
  }

  async upsert(data: UpsertTodo & { tags?: UpsertTag[] }) {
    return this.api_client.patch<TaskWithDetails>('/tasks', {
      body: data
    });
  }

  async create(data: Omit<UpsertTodo, 'task_id'> & { tags?: UpsertTag[] }) {
    return this.upsert(data)
  }

  async update(task_id: string, data: Omit<UpsertTodo, 'id'> & { tags?: UpsertTag[] }) {
	return this.upsert({ ...data, id: task_id });
  }

  async delete(task: TaskWithDetails) {
    return this.upsert({ ...task.task, visibility: 'DELETED' });
  }
}