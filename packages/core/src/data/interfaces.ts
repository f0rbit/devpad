// Data service interfaces for abstraction layer
import type { 
	Project, 
	Tag, 
	UpsertProject, 
	UpsertTodo, 
	UpsertTag, 
	UpdateData, 
	TaskWithDetails,
	User,
	ApiKey,
	ActionType,
	HistoryAction
} from "@devpad/schema";

export interface ProjectService {
	getUserProjects(userId: string): Promise<Project[]>;
	getProject(userId: string, projectId: string): Promise<{project: Project | null, error: string | null}>;
	getProjectById(projectId: string): Promise<{project: Project | null, error: string | null}>;
	getUserProjectMap(userId: string): Promise<Record<string, Project>>;
	upsertProject(data: UpsertProject, userId: string, accessToken?: string): Promise<Project>;
	getProjectConfig(projectId: string): Promise<{
		id: string | null;
		config: { tags: { name: string; match: string[] }[]; ignore: string[] } | null;
		scan_branch: string | null;
		error: string | null;
	}>;
	doesUserOwnProject(userId: string, projectId: string): Promise<boolean>;
	addProjectAction(params: {
		owner_id: string;
		project_id: string;
		type: ActionType;
		description: string;
	}): Promise<boolean>;
}

export interface TaskService {
	getUserTasks(userId: string): Promise<TaskWithDetails[]>;
	getProjectTasks(projectId: string): Promise<TaskWithDetails[]>;
	getTask(taskId: string): Promise<TaskWithDetails | null>;
	getTasksByTag(tagId: string): Promise<TaskWithDetails[]>;
	upsertTask(data: UpsertTodo, tags: UpsertTag[], userId: string): Promise<TaskWithDetails | null>;
	getUpsertedTaskMap(codebaseItems: UpdateData[]): Promise<Map<string, string>>;
	addTaskAction(params: {
		owner_id: string;
		task_id: string;
		type: ActionType;
		description: string;
		project_id: string | null;
	}): Promise<boolean>;
}

export interface TagService {
	getUserTags(userId: string): Promise<Tag[]>;
	getTaskTags(taskId: string): Promise<Tag[]>;
	upsertTag(data: UpsertTag): Promise<string>;
	getActiveUserTagsMapByName(userId: string): Promise<Map<string, string>>;
	linkTaskToTag(taskId: string, tagId: string): Promise<boolean>;
}

export interface AuthService {
	getAuthedUser(context: any): Promise<{user_id: string | null, error: string | null}>;
	getUserByApiKey(apiKey: string): Promise<{user: User | null, error: string | null}>;
	createApiKey(userId: string, name: string): Promise<{key: ApiKey, error: string | null}>;
	deleteApiKey(keyId: string): Promise<{success: boolean, error: string | null}>;
}

export interface ActionService {
	getActions(userId: string, actionFilter: ActionType[] | null): Promise<HistoryAction[]>;
}

export interface GithubService {
	getBranches(owner: string, repo: string, accessToken: string): Promise<any[]>;
	getRepo(owner: string, repo: string, accessToken: string): Promise<any>;
	getSpecification(owner: string, repo: string, accessToken: string): Promise<string>;
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