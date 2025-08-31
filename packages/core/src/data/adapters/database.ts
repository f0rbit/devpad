// Database adapter - implements data services using direct database access

import * as KeysService from "../../auth/keys.js";
import * as ActionsService from "../../services/action.js";
import * as GithubServiceImpl from "../../services/github.js";
// Import existing service functions
import * as ProjectsService from "../../services/projects.js";
import * as TagsService from "../../services/tags.js";
import * as TasksService from "../../services/tasks.js";
import type { ActionService, AuthService, DataAdapter, GithubService, ProjectService, TagService, TaskService } from "../interfaces.js";

class DatabaseProjectService implements ProjectService {
	async getUserProjects(userId: string) {
		return ProjectsService.getUserProjects(userId);
	}

	async getProject(userId: string, projectId: string) {
		return ProjectsService.getProject(userId, projectId);
	}

	async getProjectById(projectId: string) {
		return ProjectsService.getProjectById(projectId);
	}

	async getUserProjectMap(userId: string) {
		return ProjectsService.getUserProjectMap(userId);
	}

	async upsertProject(data: any, userId: string, accessToken?: string) {
		return ProjectsService.upsertProject(data, userId, accessToken);
	}

	async getProjectConfig(projectId: string) {
		return ProjectsService.getProjectConfig(projectId);
	}

	async doesUserOwnProject(userId: string, projectId: string) {
		return ProjectsService.doesUserOwnProject(userId, projectId);
	}

	async addProjectAction(params: { owner_id: string; project_id: string; type: any; description: string }) {
		return ProjectsService.addProjectAction(params);
	}
}

class DatabaseTaskService implements TaskService {
	async getUserTasks(userId: string) {
		return TasksService.getUserTasks(userId);
	}

	async getProjectTasks(projectId: string) {
		return TasksService.getProjectTasks(projectId);
	}

	async getTask(taskId: string) {
		return TasksService.getTask(taskId);
	}

	async getTasksByTag(tagId: string) {
		return TasksService.getTasksByTag(tagId);
	}

	async upsertTask(data: any, tags: any[], userId: string) {
		return TasksService.upsertTask(data, tags, userId);
	}

	async getUpsertedTaskMap(codebaseItems: any[]) {
		return TasksService.getUpsertedTaskMap(codebaseItems);
	}

	async addTaskAction(params: { owner_id: string; task_id: string; type: any; description: string; project_id: string | null }) {
		return TasksService.addTaskAction(params);
	}
}

class DatabaseTagService implements TagService {
	async getUserTags(userId: string) {
		return TagsService.getUserTags(userId);
	}

	async getTaskTags(taskId: string) {
		return TagsService.getTaskTags(taskId);
	}

	async upsertTag(data: any) {
		return TagsService.upsertTag(data);
	}

	async getActiveUserTagsMapByName(userId: string) {
		return TagsService.getActiveUserTagsMapByName(userId);
	}

	async linkTaskToTag(taskId: string, tagId: string) {
		return TagsService.linkTaskToTag(taskId, tagId);
	}
}

class DatabaseAuthService implements AuthService {
	async getAuthedUser(context: any) {
		return KeysService.getAuthedUser(context);
	}

	async getUserByApiKey(apiKey: string) {
		return KeysService.getUserByApiKey(apiKey);
	}

	async createApiKey(userId: string, name: string) {
		return KeysService.createApiKey(userId, name);
	}

	async deleteApiKey(keyId: string) {
		return KeysService.deleteApiKey(keyId);
	}
}

class DatabaseActionService implements ActionService {
	async getActions(userId: string, actionFilter: any) {
		return ActionsService.getActions(userId, actionFilter);
	}
}

class DatabaseGithubService implements GithubService {
	async getBranches(owner: string, repo: string, accessToken: string) {
		return GithubServiceImpl.getBranches(owner, repo, accessToken);
	}

	async getRepo(owner: string, repo: string, accessToken: string) {
		return GithubServiceImpl.getRepo(owner, repo, accessToken);
	}

	async getSpecification(owner: string, repo: string, accessToken: string) {
		return GithubServiceImpl.getSpecification(owner, repo, accessToken);
	}
}

export class DatabaseAdapter implements DataAdapter {
	public projects: ProjectService;
	public tasks: TaskService;
	public tags: TagService;
	public auth: AuthService;
	public actions: ActionService;
	public github: GithubService;

	constructor() {
		this.projects = new DatabaseProjectService();
		this.tasks = new DatabaseTaskService();
		this.tags = new DatabaseTagService();
		this.auth = new DatabaseAuthService();
		this.actions = new DatabaseActionService();
		this.github = new DatabaseGithubService();
	}
}

// Factory function
export function createDatabaseAdapter(): DataAdapter {
	return new DatabaseAdapter();
}
