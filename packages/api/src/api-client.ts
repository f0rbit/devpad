import type { Project, ProjectConfig, SaveConfigRequest, TaskWithDetails, UpsertProject, UpsertTag, UpsertTodo } from "@devpad/schema";
import { ApiClient as HttpClient } from "./request";

/**
 * Authentication mode for the API client
 */
export type AuthMode = "session" | "key";

/**
 * Main API client with clean nested objects
 * Provides 100% backward compatibility with better organization
 */
export class ApiClient {
	private httpClient: HttpClient;
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
		this.httpClient = new HttpClient({
			base_url: v0_base_url,
			api_key: options.api_key,
			max_history_size: options.max_history_size,
		});
	}

	/**
	 * Auth namespace - handles authentication and session management
	 */
	public readonly auth = {
		/**
		 * Get current session information
		 */
		session: () =>
			this.httpClient.get<{
				authenticated: boolean;
				user: {
					id: string;
					name: string;
					email?: string;
					github_id: number;
					image_url?: string;
					task_view: string;
				} | null;
				session: { id: string } | null;
			}>("/auth/session"),

		/**
		 * Login (redirect to OAuth)
		 */
		login: () => this.httpClient.get<void>("/auth/login"),

		/**
		 * Logout
		 */
		logout: () => this.httpClient.get<void>("/auth/logout"),

		/**
		 * Nested keys object for API key management
		 */
		keys: {
			/**
			 * List all API keys
			 */
			list: () => this.httpClient.get<{ keys: Array<{ id: string; name: string; prefix: string; created_at: string; last_used_at: string | null }> }>("/auth/keys"),

			/**
			 * Generate a new API key
			 */
			create: (name?: string) => this.httpClient.post<{ message: string; key: string }>("/auth/keys", { body: name ? { name } : {} }),

			/**
			 * Revoke an API key
			 */
			revoke: (key_id: string) => this.httpClient.delete<{ message: string; success: boolean }>(`/auth/keys/${key_id}`),

			/**
			 * Remove an API key (alias for revoke)
			 */
			remove: (key_id: string) => this.httpClient.delete<{ message: string; success: boolean }>(`/auth/keys/${key_id}`),
		},

		// === BACKWARD COMPATIBILITY METHODS ===
		generateApiKey: () => this.auth.keys.create(),
		revokeApiKey: (key_id: string) => this.auth.keys.revoke(key_id),
		getSession: () => this.auth.session(),
	};

	/**
	 * Projects namespace - handles project CRUD operations
	 */
	public readonly projects = {
		/**
		 * List projects with optional filtering
		 */
		list: (filters?: { private?: boolean }): Promise<Project[]> => {
			if (filters?.private === true) {
				// Get all projects (includes private)
				return this.httpClient.get<Project[]>("/projects");
			} else if (filters?.private === false) {
				// Get only public projects
				return this.httpClient.get<Project[]>("/projects/public");
			} else {
				// Default: get all projects
				return this.httpClient.get<Project[]>("/projects");
			}
		},

		map: async (filters?: { private?: boolean }): Promise<Record<string, Project>> => {
			const projects = await this.projects.list(filters);
			return projects.reduce(
				(acc, project) => {
					acc[project.project_id] = project;
					return acc;
				},
				{} as Record<string, Project>
			);
		},

		/**
		 * Get project by ID
		 */
		find: async (id: string): Promise<Project | null> => {
			try {
				return await this.httpClient.get<Project>("/projects", { query: { id } });
			} catch (error) {
				// If 404, return null instead of throwing
				return null;
			}
		},

		/**
		 * Create a new project
		 */
		create: (data: Omit<UpsertProject, "id">) => this.httpClient.patch<Project>("/projects", { body: data }),

		/**
		 * Update an existing project - supports both new and legacy signatures
		 */
		update: async (idOrData: string | UpsertProject, changes?: Partial<Omit<UpsertProject, "id" | "project_id">>): Promise<Project> => {
			// Handle backward compatibility: update(data)
			if (typeof idOrData === "object" && idOrData.id) {
				return this.httpClient.patch<Project>("/projects", { body: idOrData });
			}

			// Handle new clean interface: update(id, changes)
			const id = idOrData as string;
			if (!changes) {
				throw new Error("Changes parameter required for update");
			}

			// Fetch the existing project to get current values
			const existing = await this.projects.find(id);
			if (!existing) {
				throw new Error(`Project with id ${id} not found`);
			}

			// Merge changes with existing project data
			const updateData: UpsertProject = {
				id: existing.id,
				project_id: existing.project_id,
				owner_id: existing.owner_id,
				name: existing.name,
				description: existing.description,
				specification: existing.specification,
				repo_url: existing.repo_url,
				repo_id: existing.repo_id,
				icon_url: existing.icon_url,
				status: existing.status,
				deleted: existing.deleted,
				link_url: existing.link_url,
				link_text: existing.link_text,
				visibility: existing.visibility,
				current_version: existing.current_version,
				...changes,
			};

			return this.httpClient.patch<Project>("/projects", { body: updateData });
		},

		/**
		 * Delete a project (soft delete via visibility)
		 */
		remove: async (id: string): Promise<void> => {
			await this.projects.update(id, { visibility: "DELETED" });
		},

		/**
		 * Archive a project
		 */
		archive: async (id: string): Promise<Project> => {
			return this.projects.update(id, { visibility: "ARCHIVED" });
		},

		/**
		 * Publish a project (make it public)
		 */
		publish: async (id: string): Promise<Project> => {
			return this.projects.update(id, { visibility: "PUBLIC" });
		},

		/**
		 * Make a project private
		 */
		make_private: async (id: string): Promise<Project> => {
			return this.projects.update(id, { visibility: "PRIVATE" });
		},

		/**
		 * Nested config object for project configuration
		 */
		config: {
			/**
			 * Get project configuration
			 */
			load: (project_id: string) => this.httpClient.get<ProjectConfig | null>("/projects/config", { query: { project_id } }),

			/**
			 * Save project configuration
			 */
			save: (request: SaveConfigRequest) => this.httpClient.patch<void>("/projects/save_config", { body: request }),
		},

		/**
		 * Nested specification object for project specs
		 */
		specification: {
			/**
			 * Load project specification
			 */
			load: (projectId: string) => this.httpClient.get<string>("/projects/fetch_spec", { query: { project_id: projectId } }),

			/**
			 * Update project specification
			 */
			update: (projectId: string, spec: string) =>
				this.httpClient.patch<void>("/projects/spec", {
					body: { project_id: projectId, specification: spec },
				}),
		},

		/**
		 * Nested scan object for project scanning operations
		 */
		scan: {
			/**
			 * Initiate repository scan and stream results
			 */
			start: (projectId: string) => {
				// Return Response object for streaming
				const baseUrl = this.httpClient.url();
				const headers = this.httpClient.headers();
				return fetch(`${baseUrl}/projects/scan?project_id=${projectId}`, {
					method: "POST",
					headers,
				});
			},

			/**
			 * Process scan status updates
			 */
			updateStatus: (
				projectId: string,
				data: {
					id: number;
					actions: Record<string, string[]>;
					titles: Record<string, string>;
					approved: boolean;
				}
			) => this.httpClient.post<{ success: boolean }>(`/projects/scan_status?project_id=${projectId}`, { body: data }),
		},

		/**
		 * Get project history
		 */
		history: (projectId: string) => this.httpClient.get<any[]>(`/projects/${projectId}/history`),

		// === BACKWARD COMPATIBILITY METHODS ===
		getById: async (id: string) => {
			const project = await this.projects.find(id);
			if (!project) throw new Error(`Project with id ${id} not found`);
			return project;
		},

		getByName: (name: string) => this.httpClient.get<Project>("/projects", { query: { name } }),

		upsert: (data: UpsertProject) => this.httpClient.patch<Project>("/projects", { body: data }),

		upsertProject: (data: UpsertProject) => this.projects.upsert(data),

		deleteProject: (data: Omit<UpsertProject, "archived">) => {
			return this.httpClient.patch<Project>("/projects", { body: { ...data, deleted: true } });
		},

		saveConfig: (request: SaveConfigRequest) => this.projects.config.save(request),

		fetchSpecification: (projectId: string) => this.projects.specification.load(projectId),
	};

	/**
	 * Tasks namespace - handles task operations
	 */
	public readonly tasks = {
		/**
		 * List tasks with optional filtering
		 */
		list: (filters?: { project_id?: string; tag_id?: string }): Promise<TaskWithDetails[]> => {
			const query: Record<string, string> = {};
			if (filters?.project_id) query.project = filters.project_id;
			if (filters?.tag_id) query.tag = filters.tag_id;

			return this.httpClient.get<TaskWithDetails[]>("/tasks", Object.keys(query).length > 0 ? { query } : {});
		},

		/**
		 * Get task by ID
		 */
		find: async (id: string): Promise<TaskWithDetails | null> => {
			try {
				return await this.httpClient.get<TaskWithDetails>("/tasks", { query: { id } });
			} catch (error) {
				// If 404, return null instead of throwing
				return null;
			}
		},

		/**
		 * Create a new task
		 */
		create: (data: Omit<UpsertTodo, "id"> & { tags?: UpsertTag[] }) => {
			return this.httpClient.patch<TaskWithDetails>("/tasks", { body: data });
		},

		/**
		 * Update an existing task
		 */
		update: async (id: string, changes: Partial<Omit<UpsertTodo, "id">> & { tags?: UpsertTag[] }): Promise<TaskWithDetails> => {
			// Fetch existing task to merge changes
			const existing = await this.tasks.find(id);
			if (!existing) {
				throw new Error(`Task with id ${id} not found`);
			}

			const updateData = {
				id,
				title: existing.task.title,
				summary: existing.task.summary,
				description: existing.task.description,
				progress: existing.task.progress,
				visibility: existing.task.visibility,
				start_time: existing.task.start_time,
				end_time: existing.task.end_time,
				priority: existing.task.priority,
				owner_id: existing.task.owner_id,
				project_id: existing.task.project_id,
				...changes,
			};

			return this.httpClient.patch<TaskWithDetails>("/tasks", { body: updateData });
		},

		/**
		 * Delete a task (soft delete via visibility)
		 */
		remove: async (id: string): Promise<void> => {
			await this.tasks.update(id, { visibility: "DELETED" });
		},

		/**
		 * Mark task as completed
		 */
		complete: async (id: string): Promise<TaskWithDetails> => {
			return this.tasks.update(id, { progress: "COMPLETED" });
		},

		/**
		 * Start a task (mark as in progress)
		 */
		start: async (id: string): Promise<TaskWithDetails> => {
			return this.tasks.update(id, { progress: "IN_PROGRESS" });
		},

		/**
		 * Archive a task
		 */
		archive: async (id: string): Promise<TaskWithDetails> => {
			return this.tasks.update(id, { visibility: "ARCHIVED" });
		},

		/**
		 * Save tags (clean method)
		 */
		save_tags: (tags: UpsertTag[]): Promise<UpsertTag[]> => this.httpClient.patch<UpsertTag[]>("/tasks/save_tags", { body: tags }),

		/**
		 * History namespace for task history operations
		 */
		history: {
			/**
			 * Get task history by task ID
			 */
			get: (task_id: string) => this.httpClient.get<any[]>(`/tasks/history/${task_id}`),
		},

		// === BACKWARD COMPATIBILITY METHODS ===
		getById: async (id: string) => {
			const task = await this.tasks.find(id);
			if (!task) throw new Error(`Task with id ${id} not found`);
			return task;
		},

		getByProject: (project_id: string) => this.httpClient.get<TaskWithDetails[]>("/tasks", { query: { project: project_id } }),

		getByTag: (tag_id: string) => this.httpClient.get<TaskWithDetails[]>("/tasks", { query: { tag: tag_id } }),

		upsert: (data: UpsertTodo & { tags?: UpsertTag[] }) => this.httpClient.patch<TaskWithDetails>("/tasks", { body: data }),

		deleteTask: (task: TaskWithDetails) => {
			return this.httpClient.patch<TaskWithDetails>("/tasks", {
				body: {
					...task.task,
					visibility: "DELETED",
				},
			});
		},

		saveTags: (tags: UpsertTag[]) => this.tasks.save_tags(tags),
	};

	/**
	 * Milestones namespace - handles milestone operations
	 */
	public readonly milestones = {
		/**
		 * List milestones for authenticated user
		 */
		list: () => this.httpClient.get<any[]>("/milestones"),

		/**
		 * Get milestone by ID
		 */
		find: async (id: string) => {
			try {
				return await this.httpClient.get<any>(`/milestones/${id}`);
			} catch (error) {
				return null;
			}
		},

		/**
		 * Create new milestone
		 */
		create: (data: { project_id: string; name: string; description?: string; target_time?: string; target_version?: string }) => this.httpClient.post<any>("/milestones", { body: data }),

		/**
		 * Update milestone
		 */
		update: (id: string, data: { name?: string; description?: string; target_time?: string; target_version?: string }) => this.httpClient.patch<any>(`/milestones/${id}`, { body: { ...data, id } }),

		/**
		 * Delete milestone (soft delete)
		 */
		delete: (id: string) => this.httpClient.delete<{ success: boolean; message: string }>(`/milestones/${id}`),

		/**
		 * Get goals for a milestone
		 */
		goals: (id: string) => this.httpClient.get<any[]>(`/milestones/${id}/goals`),
	};

	/**
	 * Goals namespace - handles goal operations
	 */
	public readonly goals = {
		/**
		 * List goals for authenticated user
		 */
		list: () => this.httpClient.get<any[]>("/goals"),

		/**
		 * Get goal by ID
		 */
		find: async (id: string) => {
			try {
				return await this.httpClient.get<any>(`/goals/${id}`);
			} catch (error) {
				return null;
			}
		},

		/**
		 * Create new goal
		 */
		create: (data: { milestone_id: string; name: string; description?: string; target_time?: string }) => this.httpClient.post<any>("/goals", { body: data }),

		/**
		 * Update goal
		 */
		update: (id: string, data: { name?: string; description?: string; target_time?: string }) => this.httpClient.patch<any>(`/goals/${id}`, { body: { ...data, id } }),

		/**
		 * Delete goal (soft delete)
		 */
		delete: (id: string) => this.httpClient.delete<{ success: boolean; message: string }>(`/goals/${id}`),
	};

	/**
	 * Tags namespace - handles tag operations
	 */
	public readonly tags = {
		/**
		 * List all active user tags
		 */
		list: () => this.httpClient.get<any[]>("/tags"),

		/**
		 * Create or update a tag
		 */
		upsert: (_data: UpsertTag): Promise<never> => {
			throw new Error("Tags upsert endpoint not yet implemented - tags are managed through tasks");
		},

		create: (data: UpsertTag) => this.tags.upsert(data),

		update: (_tag_id: string, data: UpsertTag) => this.tags.upsert(data),
	};

	/**
	 * Get request history for debugging
	 */
	public history() {
		return this.httpClient.history();
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

	/**
	 * User namespace - handles user preferences and settings
	 */
	public readonly user = {
		/**
		 * Update user preferences
		 */
		preferences: (data: { id: string; task_view?: string; name?: string; email_verified?: boolean }) => this.httpClient.patch<{ id: string; name: string; task_view: string }>("/user/preferences", { body: data }),

		/**
		 * Get user activity history
		 */
		history: () => this.httpClient.get<any[]>("/user/history"),
	};

	/**
	 * GitHub namespace - handles GitHub integration operations
	 */
	public readonly github = {
		/**
		 * List user repositories from GitHub
		 */
		repos: () => this.httpClient.get<Array<{ id: number; name: string; full_name: string; private: boolean; html_url: string }>>("/repos"),

		/**
		 * Get repository branches
		 */
		branches: (owner: string, repo: string) => this.httpClient.get<Array<{ name: string; commit: { sha: string; url: string; message: string } }>>(`/repos/${owner}/${repo}/branches`),
	};
}
