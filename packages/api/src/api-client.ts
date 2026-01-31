import type { ApiKey, GetConfigResult, Goal, HistoryAction, Milestone, Project, ProjectConfig, SaveConfigRequest, TagWithTypedColor, TaskWithDetails, UpsertProject, UpsertTag, UpsertTodo } from "@devpad/schema";
import { ApiClient as HttpClient } from "./request";
import { type ApiResult, wrap } from "./result";

/**
 * Authentication mode for the API client
 */
export type AuthMode = "session" | "key";

/**
 * API client with Result-wrapped operations for clean error handling
 * All methods return ApiResult<T> types using @f0rbit/corpus Result
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
		const base_url = options.base_url || "http://localhost:4321/api/v1";

		this._api_key = options.api_key;
		this._auth_mode = options.auth_mode || (options.api_key.startsWith("jwt:") ? "session" : "key");

		// Create category-specific HTTP clients
		const clientOptions = {
			base_url,
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
		keys: {
			list: (): Promise<ApiResult<ApiKey[]>> => wrap(() => this.clients.auth.get<ApiKey[]>("/keys")),

			create: (name?: string): Promise<ApiResult<{ message: string; key: string }>> => wrap(() => this.clients.auth.post<{ message: string; key: string }>("/keys", { body: name ? { name } : {} })),

			revoke: (key_id: string): Promise<ApiResult<{ message: string; success: boolean }>> => wrap(() => this.clients.auth.delete<{ message: string; success: boolean }>(`/keys/${key_id}`)),

			remove: (key_id: string): Promise<ApiResult<{ message: string; success: boolean }>> => wrap(() => this.clients.auth.delete<{ message: string; success: boolean }>(`/keys/${key_id}`)),
		},
	};

	/**
	 * Projects namespace with Result-wrapped operations
	 */
	public readonly projects = {
		/**
		 * List projects with optional filtering
		 */
		list: (filters?: { private?: boolean }): Promise<ApiResult<Project[]>> => wrap(() => this.clients.projects.get<Project[]>(filters?.private === false ? "/projects/public" : "/projects")),

		/**
		 * Get project map
		 */
		map: async (filters?: { private?: boolean }): Promise<ApiResult<Record<string, Project>>> =>
			wrap(async () => {
				const result = await this.projects.list(filters);
				if (!result.ok) throw new Error(result.error.message);
				return result.value.reduce(
					(acc, project) => {
						acc[project.id] = project;
						return acc;
					},
					{} as Record<string, Project>
				);
			}),

		/**
		 * Get project by ID
		 */
		find: (id: string): Promise<ApiResult<Project | null>> => wrap(() => this.clients.projects.get<any>("/projects", { query: { id } })),

		/**
		 * Get project by name
		 */
		getByName: (name: string): Promise<ApiResult<Project>> => wrap(() => this.clients.projects.get<Project>("/projects", { query: { name } })),

		/**
		 * Get project by ID (throws if not found)
		 */
		getById: (id: string): Promise<ApiResult<Project>> => wrap(() => this.clients.projects.get<Project>("/projects", { query: { id } })),

		/**
		 * Create a new project
		 */
		create: (data: Omit<UpsertProject, "id">): Promise<ApiResult<Project>> => wrap(() => this.clients.projects.patch<Project>("/projects", { body: data })),

		/**
		 * Update an existing project
		 */
		update: async (idOrData: string | UpsertProject, changes?: Partial<Omit<UpsertProject, "id" | "project_id">>): Promise<ApiResult<Project>> =>
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
				const result = await this.projects.find(id);
				if (!result.ok) throw new Error(result.error.message);
				if (!result.value) throw new Error(`Project with id ${id} not found`);

				const project = result.value;

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
			}),

		/**
		 * Project configuration operations
		 */
		config: {
			/**
			 * Get project configuration
			 */
			load: (project_id: string): Promise<ApiResult<GetConfigResult>> => wrap(() => this.clients.projects.get<GetConfigResult>("/projects/config", { query: { project_id } })),

			/**
			 * Save project configuration
			 */
			save: (request: SaveConfigRequest): Promise<ApiResult<void>> => wrap(() => this.clients.projects.patch<void>("/projects/save_config", { body: request })),
		},

		/**
		 * Scanning operations
		 */
		scan: {
			/**
			 * Initiate a repository scan (returns stream)
			 */
			initiate: async (project_id: string): Promise<ReadableStream<string>> => {
				const response = await fetch(`${this.clients.projects.url()}/projects/scan?project_id=${project_id}`, {
					method: "POST",
					headers: this.clients.projects.headers(),
				});

				if (!response.body) {
					throw new Error("No response body");
				}

				const stream = response.body.pipeThrough(new TextDecoderStream());
				return stream;
			},

			/**
			 * Get pending scan updates for a project
			 */
			updates: (project_id: string): Promise<ApiResult<any[]>> => wrap(() => this.clients.projects.get<{ updates: any[] }>("/projects/updates", { query: { project_id } }).then(response => response.updates)),

			/**
			 * Process scan results
			 */
			update: (project_id: string, data: any): Promise<ApiResult<void>> => wrap(() => this.clients.projects.post<void>("/projects/scan_status", { query: { project_id }, body: data })),
		},

		/**
		 * Get project history
		 */
		history: (project_id: string): Promise<ApiResult<any[]>> => wrap(() => this.clients.projects.get<any[]>(`/projects/${project_id}/history`)),

		/**
		 * Legacy methods (keeping for compatibility)
		 */
		upsert: (data: UpsertProject): Promise<ApiResult<Project>> => wrap(() => this.clients.projects.patch<Project>("/projects", { body: data })),

		/**
		 * Fetch project specification from GitHub
		 */
		specification: (project_id: string): Promise<ApiResult<string>> => wrap(() => this.clients.projects.get<string>("/projects/fetch_spec", { query: { project_id } })),

		/**
		 * Delete project (soft delete)
		 */
		deleteProject: (project: Project): Promise<ApiResult<void>> => wrap(() => this.clients.projects.patch<void>("/projects", { body: { ...project, deleted: true } })),
	};

	/**
	 * Milestones namespace with Result-wrapped operations
	 */
	public readonly milestones = {
		/**
		 * List milestones for authenticated user
		 */
		list: (): Promise<ApiResult<Milestone[]>> => wrap(() => this.clients.milestones.get<any[]>("/milestones")),

		/**
		 * Get milestones by project ID
		 */
		getByProject: (project_id: string): Promise<ApiResult<Milestone[]>> => wrap(() => this.clients.milestones.get<any[]>(`/projects/${project_id}/milestones`)),

		/**
		 * Get milestone by ID
		 */
		find: (id: string): Promise<ApiResult<Milestone | null>> =>
			wrap(async () => {
				try {
					return await this.clients.milestones.get<any>(`/milestones/${id}`);
				} catch (error) {
					return null;
				}
			}),

		/**
		 * Create new milestone
		 */
		create: (data: { project_id: string; name: string; description?: string; target_time?: string; target_version?: string }): Promise<ApiResult<Milestone>> =>
			wrap(() => this.clients.milestones.post<any>("/milestones", { body: data })),

		/**
		 * Update milestone
		 */
		update: async (id: string, data: { name?: string; description?: string; target_time?: string; target_version?: string }): Promise<ApiResult<Milestone>> =>
			wrap(async () => {
				// Fetch the existing milestone to get required fields
				const result = await this.milestones.find(id);
				if (!result.ok) throw new Error(result.error.message);
				if (!result.value) throw new Error(`Milestone with id ${id} not found`);

				const milestone = result.value;

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
			}),

		/**
		 * Delete milestone (soft delete)
		 */
		delete: (id: string): Promise<ApiResult<{ success: boolean; message: string }>> => wrap(() => this.clients.milestones.delete<{ success: boolean; message: string }>(`/milestones/${id}`)),

		/**
		 * Get goals for a milestone
		 */
		goals: (id: string): Promise<ApiResult<Goal[]>> => wrap(() => this.clients.milestones.get<any[]>(`/milestones/${id}/goals`)),
	};

	/**
	 * Goals namespace with Result-wrapped operations
	 */
	public readonly goals = {
		/**
		 * List goals for authenticated user
		 */
		list: (): Promise<ApiResult<Goal[]>> => wrap(() => this.clients.goals.get<any[]>("/goals")),

		/**
		 * Get goal by ID
		 */
		find: (id: string): Promise<ApiResult<Goal | null>> => wrap(() => this.clients.goals.get<any>(`/goals/${id}`)),

		/**
		 * Create new goal
		 */
		create: (data: { milestone_id: string; name: string; description?: string; target_time?: string }): Promise<ApiResult<Goal>> => wrap(() => this.clients.goals.post<any>("/goals", { body: data })),

		/**
		 * Update goal
		 */
		update: async (id: string, data: { name?: string; description?: string; target_time?: string }): Promise<ApiResult<Goal>> =>
			wrap(async () => {
				// Fetch the existing goal to get required fields
				const result = await this.goals.find(id);
				if (!result.ok) throw new Error(result.error.message);
				if (!result.value) throw new Error(`Goal with id ${id} not found`);

				const goal = result.value;

				// Merge changes with existing goal data
				const updateData = {
					id: goal.id,
					milestone_id: goal.milestone_id,
					name: data.name ?? goal.name,
					description: data.description ?? goal.description,
					target_time: data.target_time ?? goal.target_time,
				};

				return this.clients.goals.patch<any>(`/goals/${id}`, { body: updateData });
			}),

		/**
		 * Delete goal (soft delete)
		 */
		delete: (id: string): Promise<ApiResult<{ success: boolean; message: string }>> => wrap(() => this.clients.goals.delete<{ success: boolean; message: string }>(`/goals/${id}`)),
	};

	/**
	 * Tasks namespace with Result-wrapped operations
	 */
	public readonly tasks = {
		/**
		 * List tasks with optional filtering
		 */
		list: (filters?: { project_id?: string; tag_id?: string }): Promise<ApiResult<TaskWithDetails[]>> =>
			wrap(() => {
				const query: Record<string, string> = {};
				if (filters?.project_id) query.project = filters.project_id;
				if (filters?.tag_id) query.tag = filters.tag_id;
				return this.clients.tasks.get<TaskWithDetails[]>("/tasks", Object.keys(query).length > 0 ? { query } : {});
			}),

		/**
		 * Get task by ID
		 */
		find: (id: string): Promise<ApiResult<TaskWithDetails | null>> => wrap(() => this.clients.tasks.get<any>("/tasks", { query: { id } })),

		/**
		 * Get tasks by project ID
		 */
		getByProject: (project_id: string): Promise<ApiResult<TaskWithDetails[]>> => wrap(() => this.clients.tasks.get<TaskWithDetails[]>(`/tasks`, { query: { project: project_id } })),

		/**
		 * Create a new task
		 */
		create: (data: Omit<UpsertTodo, "id"> & { tags?: UpsertTag[] }): Promise<ApiResult<TaskWithDetails>> => wrap(() => this.clients.tasks.patch<TaskWithDetails>("/tasks", { body: data })),

		/**
		 * Update an existing task
		 */
		update: async (id: string, changes: Partial<Omit<UpsertTodo, "id">> & { tags?: UpsertTag[] }): Promise<ApiResult<TaskWithDetails>> =>
			wrap(async () => {
				// Fetch existing task to merge changes
				const result = await this.tasks.find(id);
				if (!result.ok) throw new Error(result.error.message);
				if (!result.value) throw new Error(`Task with id ${id} not found`);

				const task = result.value;

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
			}),

		/**
		 * Upsert task (create or update)
		 */
		upsert: (data: UpsertTodo & { tags?: UpsertTag[] }): Promise<ApiResult<TaskWithDetails>> => wrap(() => this.clients.tasks.patch<TaskWithDetails>("/tasks", { body: data })),

		/**
		 * Save tags for tasks
		 */
		saveTags: (data: any): Promise<ApiResult<void>> => wrap(() => this.clients.tasks.post<void>("/tasks/save_tags", { body: data })),

		/**
		 * Delete task (soft delete)
		 */
		deleteTask: (task: TaskWithDetails): Promise<ApiResult<void>> => wrap(() => this.clients.tasks.patch<void>("/tasks", { body: { ...task.task, deleted: true } })),

		/**
		 * Task history operations
		 */
		history: {
			/**
			 * Get task history by task ID
			 */
			get: (task_id: string): Promise<ApiResult<HistoryAction[]>> => wrap(() => this.clients.tasks.get<HistoryAction[]>(`/tasks/history/${task_id}`)),
		},
	};

	/**
	 * Tags namespace with Result-wrapped operations
	 */
	public readonly tags = {
		/**
		 * List tags for authenticated user
		 */
		list: (): Promise<ApiResult<TagWithTypedColor[]>> => wrap(() => this.clients.tags.get<TagWithTypedColor[]>("/tags")),
	};

	/**
	 * GitHub namespace with Result-wrapped operations
	 */
	public readonly github = {
		/**
		 * List repositories for authenticated user
		 */
		repos: (): Promise<ApiResult<any[]>> => wrap(() => this.clients.github.get<any[]>("/repos")),

		/**
		 * List branches for a GitHub repository
		 */
		branches: (owner: string, repo: string): Promise<ApiResult<any[]>> => wrap(() => this.clients.github.get<any[]>(`/repos/${owner}/${repo}/branches`)),
	};

	/**
	 * User namespace with Result-wrapped operations
	 */
	public readonly user = {
		/**
		 * Get user activity history
		 */
		history: (): Promise<ApiResult<any[]>> => wrap(() => this.clients.auth.get<any[]>("/user/history")),

		/**
		 * Update user preferences
		 */
		preferences: (data: { id: string; task_view: string }): Promise<ApiResult<any>> => wrap(() => this.clients.auth.patch<any>("/user/preferences", { body: data })),
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
