// Data service interfaces for abstraction layer
import type { ActionType, ApiKey, HistoryAction, Project, Tag, TaskWithDetails, UpdateData, UpsertProject, UpsertTag, UpsertTodo, User } from "@devpad/schema";

export interface ProjectService {
	getUserProjects(userId: string): Promise<Project[]>;
	getProject(userId: string, projectId: string): Promise<{ project: Project | null; error: string | null }>;
	getProjectById(projectId: string): Promise<{ project: Project | null; error: string | null }>;
	getUserProjectMap(userId: string): Promise<Record<string, Project>>;
	upsertProject(data: UpsertProject, userId: string, accessToken?: string): Promise<Project>;
	getProjectConfig(projectId: string): Promise<{
		id: string | null;
		config: { tags: { name: string; match: string[] }[]; ignore: string[] } | null;
		scan_branch: string | null;
		error: string | null;
	}>;
	doesUserOwnProject(userId: string, projectId: string): Promise<boolean>;
	addProjectAction(params: { owner_id: string; project_id: string; type: ActionType; description: string }): Promise<boolean>;
}

export interface TaskService {
	getUserTasks(userId: string): Promise<TaskWithDetails[]>;
	getProjectTasks(projectId: string): Promise<TaskWithDetails[]>;
	getTask(taskId: string): Promise<TaskWithDetails | null>;
	getTasksByTag(tagId: string): Promise<TaskWithDetails[]>;
	upsertTask(data: UpsertTodo, tags: UpsertTag[], userId: string): Promise<TaskWithDetails | null>;
	getUpsertedTaskMap(codebaseItems: UpdateData[]): Promise<Map<string, string>>;
	addTaskAction(params: { owner_id: string; task_id: string; type: ActionType; description: string; project_id: string | null }): Promise<boolean>;
}

export interface TagService {
	getUserTags(userId: string): Promise<Tag[]>;
	getTaskTags(taskId: string): Promise<Tag[]>;
	upsertTag(data: UpsertTag): Promise<string>;
	getActiveUserTagsMapByName(userId: string): Promise<Map<string, Tag>>;
	linkTaskToTag(taskId: string, tagId: string): Promise<boolean>;
}

export interface AuthService {
	getAuthedUser(context: any): Promise<{ user_id: string | null; error: string | null }>;
	getUserByApiKey(apiKey: string): Promise<{ user: User | null; error: string | null }>;
	createApiKey(userId: string, name: string): Promise<{ key: ApiKey; error: string | null }>;
	deleteApiKey(keyId: string): Promise<{ success: boolean; error: string | null }>;
}

export interface ActionService {
	getActions(userId: string, actionFilter: ActionType[] | null): Promise<HistoryAction[]>;
}

import type { Endpoints } from "@octokit/types";

export type GitHubBranch = Endpoints["GET /repos/{owner}/{repo}/branches"]["response"]["data"][0] & {
	commit: {
		sha: string;
		url: string;
		message: string;
		author_name: string;
		author_email: string;
		date: string;
		avatar_url: string | null;
		author_user: string;
	};
};

export interface GitHubRepo {
	status: number;
	arrayBuffer(): Promise<ArrayBuffer>;
}

export interface GithubService {
	getBranches(owner: string, repo: string, accessToken: string): Promise<GitHubBranch[]>;
	getRepo(owner: string, repo: string, accessToken: string, branch?: string | null): Promise<GitHubRepo>;
	getSpecification(owner: string, repo: string, accessToken: string): Promise<string>;
	getRepos(accessToken: string): Promise<Endpoints["GET /user/repos"]["response"]["data"]>;
}

// Main data adapter interface
export interface DataAdapter {
	projects: ProjectService;
	tasks: TaskService;
	tags: TagService;
	auth: AuthService;
	actions: ActionService;
	github: GithubService;
}

// Factory function type
export type DataAdapterFactory = (config?: any) => DataAdapter;
