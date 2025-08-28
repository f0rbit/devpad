import type { Task } from '@/src/server/tasks';
import type { UpsertTag, UpsertTodo } from '@/src/server/types';
import { ApiClient } from '../utils/request';

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
    
    return this.api_client.get<Task[]>('/tasks', 
      Object.keys(query).length > 0 ? { query } : {}
    );
  }

  async get(id: string) {
    // GET /tasks?id=<task_id>
    return this.api_client.get<Task>('/tasks', {
      query: { id }
    });
  }

  async getByProject(project_id: string) {
    // GET /tasks?project=<project_id>
    return this.api_client.get<Task[]>('/tasks', {
      query: { project: project_id }
    });
  }

  async getByTag(tag_id: string) {
    // GET /tasks?tag=<tag_id>
    return this.api_client.get<Task[]>('/tasks', {
      query: { tag: tag_id }
    });
  }

  async upsert(data: UpsertTodo & { tags?: UpsertTag[] }) {
    return this.api_client.patch<Task>('/tasks', {
      body: data
    });
  }

  async create(data: Omit<UpsertTodo, 'task_id'> & { tags?: UpsertTag[] }) {
    return this.upsert(data)
  }

  async update(task_id: string, data: Omit<UpsertTodo, 'id'> & { tags?: UpsertTag[] }) {
	return this.upsert({ ...data, id: task_id });
  }

  async delete(task: Task) {
    return this.upsert({ ...task.task, visibility: 'DELETED' });
  }
}