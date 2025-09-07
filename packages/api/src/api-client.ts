import type { Project, ProjectConfig, SaveConfigRequest, TaskWithDetails, UpsertProject, UpsertTag, UpsertTodo, Milestone, Goal, HistoryAction, TagWithTypedColor } from "@devpad/schema";
import { ApiClient as HttpClient } from "./request";
import { wrap, type Result } from "./result";

/**
 * Authentication mode for the API client
 */
export type AuthMode = "session" | "key";

/**
 * API client with Result-wrapped operations for clean error handling
 * All methods return Result<T, name> types with context-aware property names
 */
export class ApiClient {
	private readonly clients;
	private _api_key: string;
	private _auth_mode: AuthMode;

	constructor(options: {
		base_url?: string;
		api_key: string;
		auth_mode?: AuthMode;
		max_history_size?: number;
	}) {
		const v0_base_url = options.base_url || "http://localhost:4321/api/v0";

		this._api_key = options.api_key;
		this._auth_mode = options.auth_mode || (options.api_key.startsWith("jwt:") ? "session" : "key");

		// Create category-specific HTTP clients
		const clientOptions = {
			base_url: v0_base_url,
			api_key: options.api_key,
			max_history_size: options.max_history_size,
		};

		this.clients = {
			auth: new HttpClient({ ...clientOptions, category: "auth" }),
			projects: new HttpClient({ ...clientOptions, category: "projects" }),
			tasks: new HttpClient({ ...clientOptions, category: "tasks" }),
			milestones: new HttpClient({ ...clientOptions, category: "milestones" }),
			goals: new HttpClient({ ...clientOptions, category: "goals" }),
			github: new HttpClient({ ...clientOptions, category: "github" }),
			tags: new HttpClient({ ...clientOptions, category: "tags" }),
		} as const;
	}

	/**
	 * Auth namespace with Result-wrapped operations
	 */
	public readonly auth = {
		/**
		 * Get current session information
		 */
		session: (): Promise<Result<{ authenticated: boolean; user: any; session: any }, "session">> => wrap(() => this.clients.auth.get<{ authenticated: boolean; user: any; session: any }>("/auth/session"), "session"),

		/**
		 * Login (redirect to OAuth)
		 */
		login: (): Promise<Result<void, "result">> => wrap(() => this.clients.auth.get<void>("/auth/login"), "result"),

		/**
		 * Logout
		 */
		logout: (): Promise<Result<void, "result">> => wrap(() => this.clients.auth.get<void>("/auth/logout"), "result"),

		/**
		 * API key management
		 */
		keys: {
			/**
			 * List all API keys
			 */
			list: (): Promise<Result<{ keys: Array<{ id: string; name: string; prefix: string; created_at: string; last_used_at: string | null }> }, "keys">> => wrap(() => this.clients.auth.get<{ keys: Array<any> }>("/auth/keys"), "keys"),

			/**
			 * Generate a new API key
			 */
			create: (name?: string): Promise<Result<{ message: string; key: string }, "key">> => wrap(() => this.clients.auth.post<{ message: string; key: string }>("/auth/keys", { body: name ? { name } : {} }), "key"),

			/**
			 * Revoke an API key
			 */
			revoke: (key_id: string): Promise<Result<{ message: string; success: boolean }, "result">> => wrap(() => this.clients.auth.delete<{ message: string; success: boolean }>(`/auth/keys/${key_id}`), "result"),

			/**
			 * Remove an API key (alias for revoke)
			 */
			remove: (key_id: string): Promise<Result<{ message: string; success: boolean }, "result">> => wrap(() => this.clients.auth.delete<{ message: string; success: boolean }>(`/auth/keys/${key_id}`), "result"),
		},

		// Legacy methods (keeping for now)
		generateApiKey: () => this.auth.keys.create(),
		revokeApiKey: (key_id: string) => this.auth.keys.revoke(key_id),
		getSession: () => this.auth.session(),
	};

	/**
	 * Projects namespace with Result-wrapped operations
	 */
	public readonly projects = {
		/**
		 * List projects with optional filtering
		 */
		list: (filters?: { private?: boolean }): Promise<Result<Project[], "projects">> =>
			wrap(() => {
				if (filters?.private === true) {
					return this.clients.projects.get<Project[]>("/projects");
				} else if (filters?.private === false) {
					return this.clients.projects.get<Project[]>("/projects/public");
				} else {
					return this.clients.projects.get<Project[]>("/projects");
				}
			}, "projects"),

		/**
		 * Get project map
		 */
		map: async (filters?: { private?: boolean }): Promise<Result<Record<string, Project>, "project_map">> =>
			wrap(async () => {
				const { projects, error } = await this.projects.list(filters);
				if (error) throw new Error(error.message);
				return projects!.reduce(
					(acc, project) => {
						acc[project.project_id] = project;
						return acc;
					},
					{} as Record<string, Project>
				);
			}, "project_map"),

		/**
		 * Get project by ID
		 */
		find: (id: string): Promise<Result<Project | null, "project">> => wrap(() => this.clients.projects.get<any>("/projects", { query: { id } }), "project"),

		/**
		 * Get project by name
		 */
		getByName: (name: string): Promise<Result<Project, "project">> => wrap(() => this.clients.projects.get<Project>("/projects", { query: { name } }), "project"),

		/**
		 * Get project by ID (throws if not found)
		 */
		getById: (id: string): Promise<Result<Project, "project">> => wrap(() => this.clients.projects.get<Project>("/projects", { query: { id } }), "project"),

		/**
		 * Create a new project
		 */
		create: (data: Omit<UpsertProject, "id">): Promise<Result<Project, "project">> => wrap(() => this.clients.projects.patch<Project>("/projects", { body: data }), "project"),

		/**
		 * Update an existing project
		 */
		update: async (idOrData: string | UpsertProject, changes?: Partial<Omit<UpsertProject, "id" | "project_id">>): Promise<Result<Project, "project">> =>
			wrap(async () => {
				// Handle backward compatibility: update(data)
				if (typeof idOrData === "object" && idOrData.id) {
					return this.clients.projects.patch<Project>("/projects", { body: idOrData });
				}

				// Handle new clean interface: update(id, changes)
				const id = idOrData as string;
				if (!changes) {
					throw new Error("Changes parameter required for update");
				}

				// Fetch the existing project to get current values
				const { project, error } = await this.projects.find(id);
				if (error) throw new Error(error.message);
				if (!project) throw new Error(`Project with id ${id} not found`);

				// Merge changes with existing project data
				const updateData: UpsertProject = {
					id: project.id,
					project_id: project.project_id,
					owner_id: project.owner_id,
					name: project.name,
					description: project.description,
					specification: project.specification,
					repo_url: project.repo_url,
					repo_id: project.repo_id,
					icon_url: project.icon_url,
					status: project.status,
					deleted: project.deleted,
					link_url: project.link_url,
					link_text: project.link_text,
					visibility: project.visibility,
					current_version: project.current_version,
					...changes,
				};

				return this.clients.projects.patch<Project>("/projects", { body: updateData });
			}, "project"),

		/**
		 * Project configuration operations
		 */
		config: {
			/**
			 * Get project configuration
			 */
			load: (project_id: string): Promise<Result<ProjectConfig | null, "config">> => wrap(() => this.clients.projects.get<ProjectConfig | null>("/projects/config", { query: { project_id } }), "config"),

			/**
			 * Save project configuration
			 */
			save: (request: SaveConfigRequest): Promise<Result<void, "result">> => wrap(() => this.clients.projects.patch<void>("/projects/save_config", { body: request }), "result"),
		},

		/**
		 * Save project configuration (alias for compatibility)
		 */
		saveConfig: (request: SaveConfigRequest): Promise<Result<void, "result">> => wrap(() => this.clients.projects.patch<void>("/projects/save_config", { body: request }), "result"),

		/**
		 * Scanning operations
		 */
		scan: {
			/**
			 * Update scan status
			 */
			updateStatus: (project_id: string, data: any): Promise<Result<void, "result">> => wrap(() => this.clients.projects.post<void>(`/projects/${project_id}/scan/status`, { body: data }), "result"),
		},

		/**
		 * Get project history
		 */
		history: (project_id: string): Promise<Result<any[], "history">> => wrap(() => this.clients.projects.get<any[]>(`/projects/${project_id}/history`), "history"),

		/**
		 * Legacy methods (keeping for compatibility)
		 */
		upsert: (data: UpsertProject): Promise<Result<Project, "project">> => wrap(() => this.clients.projects.patch<Project>("/projects", { body: data }), "project"),

		/**
		 * Fetch project specification from GitHub
		 */
		fetchSpecification: (project_id: string): Promise<Result<string, "specification">> => wrap(() => this.clients.projects.get<string>("/projects/fetch_spec", { query: { project_id } }), "specification"),

		/**
		 * Delete project (soft delete)
		 */
		deleteProject: (project: Project): Promise<Result<void, "result">> => wrap(() => this.clients.projects.patch<void>("/projects", { body: { ...project, deleted: true } }), "result"),
	};

	/**
	 * Milestones namespace with Result-wrapped operations
	 */
	public readonly milestones = {
		/**
		 * List milestones for authenticated user
		 */
		list: (): Promise<Result<Milestone[], "milestones">> => wrap(() => this.clients.milestones.get<any[]>("/milestones"), "milestones"),

		/**
		 * Get milestones by project ID
		 */
		getByProject: (project_id: string): Promise<Result<Milestone[], "milestones">> => wrap(() => this.clients.milestones.get<any[]>(`/projects/${project_id}/milestones`), "milestones"),

		/**
		 * Get milestone by ID
		 */
		find: (id: string): Promise<Result<Milestone | null, "milestone">> =>
			wrap(async () => {
				try {
					return await this.clients.milestones.get<any>(`/milestones/${id}`);
				} catch (error) {
					return null;
				}
			}, "milestone"),

		/**
		 * Create new milestone
		 */
		create: (data: { project_id: string; name: string; description?: string; target_time?: string; target_version?: string }): Promise<Result<Milestone, "milestone">> =>
			wrap(() => this.clients.milestones.post<any>("/milestones", { body: data }), "milestone"),

		/**
		 * Update milestone
		 */
		update: async (id: string, data: { name?: string; description?: string; target_time?: string; target_version?: string }): Promise<Result<Milestone, "milestone">> =>
			wrap(async () => {
				// Fetch the existing milestone to get required fields
				const { milestone, error } = await this.milestones.find(id);
				if (error) throw new Error(error.message);
				if (!milestone) throw new Error(`Milestone with id ${id} not found`);

				// Merge changes with existing milestone data
				const updateData = {
					id: milestone.id,
					project_id: milestone.project_id,
					name: data.name ?? milestone.name,
					description: data.description ?? milestone.description,
					target_time: data.target_time ?? milestone.target_time,
					target_version: data.target_version ?? milestone.target_version,
				};

				return this.clients.milestones.patch<any>(`/milestones/${id}`, { body: updateData });
			}, "milestone"),

		/**
		 * Delete milestone (soft delete)
		 */
		delete: (id: string): Promise<Result<{ success: boolean; message: string }, "result">> => wrap(() => this.clients.milestones.delete<{ success: boolean; message: string }>(`/milestones/${id}`), "result"),

		/**
		 * Get goals for a milestone
		 */
		goals: (id: string): Promise<Result<Goal[], "goals">> => wrap(() => this.clients.milestones.get<any[]>(`/milestones/${id}/goals`), "goals"),
	};

	/**
	 * Goals namespace with Result-wrapped operations
	 */
	public readonly goals = {
		/**
		 * List goals for authenticated user
		 */
		list: (): Promise<Result<Goal[], "goals">> => wrap(() => this.clients.goals.get<any[]>("/goals"), "goals"),

		/**
		 * Get goal by ID
		 */
		find: (id: string): Promise<Result<Goal | null, "goal">> => wrap(() => this.clients.goals.get<any>(`/goals/${id}`), "goal"),

		/**
		 * Create new goal
		 */
		create: (data: { milestone_id: string; name: string; description?: string; target_time?: string }): Promise<Result<Goal, "goal">> => wrap(() => this.clients.goals.post<any>("/goals", { body: data }), "goal"),

		/**
		 * Update goal
		 */
		update: async (id: string, data: { name?: string; description?: string; target_time?: string }): Promise<Result<Goal, "goal">> =>
			wrap(async () => {
				// Fetch the existing goal to get required fields
				const { goal, error } = await this.goals.find(id);
				if (error) throw new Error(error.message);
				if (!goal) throw new Error(`Goal with id ${id} not found`);

				// Merge changes with existing goal data
				const updateData = {
					id: goal.id,
					milestone_id: goal.milestone_id,
					name: data.name ?? goal.name,
					description: data.description ?? goal.description,
					target_time: data.target_time ?? goal.target_time,
				};

				return this.clients.goals.patch<any>(`/goals/${id}`, { body: updateData });
			}, "goal"),

		/**
		 * Delete goal (soft delete)
		 */
		delete: (id: string): Promise<Result<{ success: boolean; message: string }, "result">> => wrap(() => this.clients.goals.delete<{ success: boolean; message: string }>(`/goals/${id}`), "result"),
	};

	/**
	 * Tasks namespace with Result-wrapped operations
	 */
	public readonly tasks = {
		/**
		 * List tasks with optional filtering
		 */
		list: (filters?: { project_id?: string; tag_id?: string }): Promise<Result<TaskWithDetails[], "tasks">> =>
			wrap(() => {
				const query: Record<string, string> = {};
				if (filters?.project_id) query.project = filters.project_id;
				if (filters?.tag_id) query.tag = filters.tag_id;
				return this.clients.tasks.get<TaskWithDetails[]>("/tasks", Object.keys(query).length > 0 ? { query } : {});
			}, "tasks"),

		/**
		 * Get task by ID
		 */
		find: (id: string): Promise<Result<TaskWithDetails | null, "task">> => wrap(() => this.clients.tasks.get<any>("/tasks", { query: { id } }), "task"),

		/**
		 * Get tasks by project ID
		 */
		getByProject: (project_id: string): Promise<Result<TaskWithDetails[], "tasks">> => wrap(() => this.clients.tasks.get<TaskWithDetails[]>(`/projects/${project_id}/tasks`), "tasks"),

		/**
		 * Create a new task
		 */
		create: (data: Omit<UpsertTodo, "id"> & { tags?: UpsertTag[] }): Promise<Result<TaskWithDetails, "task">> => wrap(() => this.clients.tasks.patch<TaskWithDetails>("/tasks", { body: data }), "task"),

		/**
		 * Update an existing task
		 */
		update: async (id: string, changes: Partial<Omit<UpsertTodo, "id">> & { tags?: UpsertTag[] }): Promise<Result<TaskWithDetails, "task">> =>
			wrap(async () => {
				// Fetch existing task to merge changes
				const { task, error } = await this.tasks.find(id);
				if (error) throw new Error(error.message);
				if (!task) throw new Error(`Task with id ${id} not found`);

				const updateData = {
					id,
					title: task.task.title,
					summary: task.task.summary,
					description: task.task.description,
					progress: task.task.progress,
					visibility: task.task.visibility,
					start_time: task.task.start_time,
					end_time: task.task.end_time,
					priority: task.task.priority,
					owner_id: task.task.owner_id,
					project_id: task.task.project_id,
					...changes,
				};

				return this.clients.tasks.patch<TaskWithDetails>("/tasks", { body: updateData });
			}, "task"),

		/**
		 * Upsert task (create or update)
		 */
		upsert: (data: UpsertTodo & { tags?: UpsertTag[] }): Promise<Result<TaskWithDetails, "task">> => wrap(() => this.clients.tasks.patch<TaskWithDetails>("/tasks", { body: data }), "task"),

		/**
		 * Save tags for tasks
		 */
		saveTags: (data: any): Promise<Result<void, "result">> => wrap(() => this.clients.tasks.post<void>("/tasks/save_tags", { body: data }), "result"),

		/**
		 * Delete task (soft delete)
		 */
		deleteTask: (task: TaskWithDetails): Promise<Result<void, "result">> => wrap(() => this.clients.tasks.patch<void>("/tasks", { body: { ...task.task, deleted: true } }), "result"),

		/**
		 * Task history operations
		 */
		history: {
			/**
			 * Get task history by task ID
			 */
			get: (task_id: string): Promise<Result<HistoryAction[], "history">> => wrap(() => this.clients.tasks.get<HistoryAction[]>(`/tasks/history/${task_id}`), "history"),
		},
	};

	/**
	 * Tags namespace with Result-wrapped operations
	 */
	public readonly tags = {
		/**
		 * List tags for authenticated user
		 */
		list: (): Promise<Result<TagWithTypedColor[], "tags">> => wrap(() => this.clients.tags.get<TagWithTypedColor[]>("/tags"), "tags"),
	};

	/**
	 * GitHub namespace with Result-wrapped operations
	 */
	public readonly github = {
		/**
		 * List repositories for authenticated user
		 */
		repos: (): Promise<Result<any[], "repos">> => wrap(() => this.clients.github.get<any[]>("/repos"), "repos"),

		/**
		 * List branches for a GitHub repository
		 */
		branches: (owner: string, repo: string): Promise<Result<any[], "branches">> => wrap(() => this.clients.github.get<any[]>(`/repos/${owner}/${repo}/branches`), "branches"),
	};

	/**
	 * User namespace with Result-wrapped operations
	 */
	public readonly user = {
		/**
		 * Get user activity history
		 */
		history: (): Promise<Result<any[], "history">> => wrap(() => this.clients.auth.get<any[]>("/user/history"), "history"),

		/**
		 * Update user preferences
		 */
		preferences: (data: { id: string; task_view: string }): Promise<Result<any, "result">> => wrap(() => this.clients.auth.patch<any>("/user/preferences", { body: data }), "result"),
	};

	/**
	 * Keys namespace with Result-wrapped operations
	 */
	public readonly keys = {
		/**
		 * List API keys for authenticated user
		 */
		list: (): Promise<Result<{ keys: any[] }, "keys">> => wrap(() => this.clients.auth.get<{ keys: any[] }>("/auth/keys"), "keys"),
	};

	/**
	 * Get request history for debugging
	 */
	public history() {
		return this.clients.projects.history();
	}

	/**
	 * Get the API key
	 */
	public getApiKey(): string {
		return this._api_key;
	}

	/**
	 * Get the authentication mode
	 */
	public getAuthMode(): AuthMode {
		return this._auth_mode;
	}
}
