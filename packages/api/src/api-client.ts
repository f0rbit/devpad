import type { VersionInfo } from "@devpad/schema/blog/corpus";
import type {
	AccessKey,
	Category,
	CategoryCreate,
	Post,
	PostContent,
	PostCreate,
	PostListParams,
	PostsResponse,
	PostUpdate,
} from "@devpad/schema/blog/types";
import type { PlatformSettings } from "@devpad/schema/media/settings";
import type { Timeline } from "@devpad/schema/media/timeline";
import type {
	Account,
	AddFilterInput,
	CreateProfileInput,
	Profile,
	ProfileFilter,
	UpdateProfileInput,
} from "@devpad/schema/media/types";
import type {
	ApiKey,
	GetConfigResult,
	Goal,
	HistoryAction,
	Milestone,
	PipelineAnalysisTemplate,
	PipelineGrant,
	PipelineOidcTrust,
	PipelinePackage,
	PipelineRun,
	PipelineStageEvent,
	Project,
	SaveConfigRequest,
	StageEventKind,
	TagWithTypedColor,
	TaskWithDetails,
	TodoUpdate,
	UpsertProject,
	UpsertTag,
	UpsertTodo,
} from "@devpad/schema/types";
import type { DashboardResponse } from "@devpad/schema/validation";
import { ApiClient as HttpClient } from "./request";
import { type ApiResult, wrap } from "./result";

type TagWithCount = { tag: string; count: number };
type SanitizedToken = {
	id: string;
	name: string | null;
	note: string | null;
	enabled: boolean;
	created_at: string;
};
type CreatedToken = SanitizedToken & { token: string };
type AccessKeyCreate = { name: string; note?: string };
type AccessKeyUpdate = { name?: string; note?: string; enabled?: boolean };
type SessionUser = {
	id: string;
	name: string | null;
	email?: string | null;
	github_id: number | null;
	image_url?: string | null;
	task_view: "list" | "grid";
};
type SessionInfo = { id: string };
type ScanStatusUpdate = {
	id: number;
	actions: Record<string, string[]>;
	titles: Record<string, string>;
	approved: boolean;
};
// Minimal subset of GitHub's REST API repo/branch shapes — the full response
// types (`Endpoints[...]` from octokit) live in `@devpad/core`'s github
// service, which this package doesn't depend on. Only the fields the
// frontend actually reads are modelled here.
type GithubRepo = { name: string; full_name: string; private: boolean; default_branch: string };
type GithubBranch = { name: string; commit: { sha: string; message?: string } };
// The media-connections GitHub repo listing is a distinct, pre-normalised
// shape from `@devpad/core`'s connection service (not the raw octokit
// response `GithubRepo` above models) — field names genuinely differ
// (`is_private` vs `private`, no `default_branch`).
type MediaGithubRepo = { full_name: string; name: string; owner: string; is_private: boolean; pushed_at: string | null };

/**
 * Authentication mode for the API client
 */
export type AuthMode = "session" | "key" | "cookie";

/**
 * API client with Result-wrapped operations for clean error handling
 * All methods return ApiResult<T> types using @f0rbit/corpus Result
 */
export class ApiClient {
	private readonly clients;
	private readonly api_key_field: string;
	private readonly auth_mode_field: AuthMode;

	constructor(options: {
		base_url?: string;
		api_key?: string;
		auth_mode?: AuthMode;
		max_history_size?: number;
		credentials?: "include" | "omit" | "same-origin";
		default_headers?: Record<string, string>;
		custom_fetch?: typeof fetch;
	}) {
		const base_url = options.base_url || "http://localhost:4321/api/v1";

		this.api_key_field = options.api_key ?? "";
		this.auth_mode_field =
			options.auth_mode ?? (options.api_key?.startsWith("jwt:") ? "session" : options.api_key ? "key" : "cookie");

		const clientOptions = {
			base_url,
			api_key: options.api_key,
			max_history_size: options.max_history_size,
			auth_mode: this.auth_mode_field,
			credentials: options.credentials,
			default_headers: options.default_headers,
			custom_fetch: options.custom_fetch,
		};

		const auth_base_url = base_url.replace(/\/v1\/?$/, "");

		this.clients = {
			auth: new HttpClient({ ...clientOptions, category: "auth" }),
			auth_root: new HttpClient({
				...clientOptions,
				base_url: auth_base_url,
				category: "auth",
			}),
			projects: new HttpClient({ ...clientOptions, category: "projects" }),
			tasks: new HttpClient({ ...clientOptions, category: "tasks" }),
			milestones: new HttpClient({ ...clientOptions, category: "milestones" }),
			goals: new HttpClient({ ...clientOptions, category: "goals" }),
			github: new HttpClient({ ...clientOptions, category: "github" }),
			tags: new HttpClient({ ...clientOptions, category: "tags" }),
			blog: new HttpClient({ ...clientOptions, category: "blog" }),
			media: new HttpClient({ ...clientOptions, category: "media" }),
			pulse: new HttpClient({ ...clientOptions, base_url: `${base_url}/pulse`, category: "pulse" }),
			pipelines: new HttpClient({ ...clientOptions, category: "pipelines" }),
		} as const;
	}

	/**
	 * Auth namespace with Result-wrapped operations
	 */
	public readonly auth = {
		session: (): Promise<
			ApiResult<{ authenticated: boolean; user: SessionUser | null; session: SessionInfo | null; scope?: string }>
		> =>
			wrap(() =>
				this.clients.auth_root.get<{
					authenticated: boolean;
					user: SessionUser | null;
					session: SessionInfo | null;
					scope?: string;
				}>("/auth/session"),
			),

		keys: {
			list: (): Promise<ApiResult<ApiKey[]>> => wrap(() => this.clients.auth.get<ApiKey[]>("/keys")),

			create: (
				input?: string | { name?: string; scope?: "devpad" | "blog" | "media" | "pulse" | "all" },
			): Promise<ApiResult<{ message: string; key: { key: ApiKey; raw_key: string } }>> => {
				const body = typeof input === "string" ? { name: input } : (input ?? {});
				return wrap(() =>
					this.clients.auth.post<{ message: string; key: { key: ApiKey; raw_key: string } }>("/keys", { body }),
				);
			},

			revoke: (key_id: string): Promise<ApiResult<{ message: string; success: boolean }>> =>
				wrap(() => this.clients.auth.delete<{ message: string; success: boolean }>(`/keys/${key_id}`)),

			remove: (key_id: string): Promise<ApiResult<{ message: string; success: boolean }>> =>
				wrap(() => this.clients.auth.delete<{ message: string; success: boolean }>(`/keys/${key_id}`)),
		},
	};

	/**
	 * Projects namespace with Result-wrapped operations
	 */
	public readonly projects = {
		/**
		 * List projects with optional filtering
		 */
		list: (filters?: { private?: boolean }): Promise<ApiResult<Project[]>> =>
			wrap(() => this.clients.projects.get<Project[]>(filters?.private === false ? "/projects/public" : "/projects")),

		/**
		 * Get project map
		 */
		map: async (filters?: { private?: boolean }): Promise<ApiResult<Record<string, Project>>> =>
			wrap(async () => {
				const result = await this.projects.list(filters);
				if (!result.ok) throw new Error(result.error.message);
				return result.value.reduce<Record<string, Project>>((acc, project) => {
					acc[project.id] = project;
					return acc;
				}, {});
			}),

		/**
		 * Get project by ID
		 */
		find: (id: string): Promise<ApiResult<Project | null>> =>
			wrap(() => this.clients.projects.get<Project | null>("/projects", { query: { id } })),

		/**
		 * Get project by name
		 */
		getByName: (name: string): Promise<ApiResult<Project>> =>
			wrap(() => this.clients.projects.get<Project>("/projects", { query: { name } })),

		/**
		 * Get project by ID (throws if not found)
		 */
		getById: (id: string): Promise<ApiResult<Project>> =>
			wrap(() => this.clients.projects.get<Project>("/projects", { query: { id } })),

		/**
		 * Create a new project
		 */
		create: (data: Omit<UpsertProject, "id">): Promise<ApiResult<Project>> =>
			wrap(() => this.clients.projects.patch<Project>("/projects", { body: data })),

		/**
		 * Update an existing project
		 */
		update: async (
			idOrData: string | UpsertProject,
			changes?: Partial<Omit<UpsertProject, "id" | "project_id">>,
		): Promise<ApiResult<Project>> =>
			wrap(async () => {
				// Handle backward compatibility: update(data)
				if (typeof idOrData === "object" && idOrData.id) {
					return this.clients.projects.patch<Project>("/projects", {
						body: idOrData,
					});
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

				return this.clients.projects.patch<Project>("/projects", {
					body: updateData,
				});
			}),

		/**
		 * Project configuration operations
		 */
		config: {
			/**
			 * Get project configuration
			 */
			load: (project_id: string): Promise<ApiResult<GetConfigResult>> =>
				wrap(() =>
					this.clients.projects.get<GetConfigResult>("/projects/config", {
						query: { project_id },
					}),
				),

			/**
			 * Save project configuration
			 */
			save: (request: SaveConfigRequest): Promise<ApiResult<void>> =>
				wrap(() =>
					this.clients.projects.patch("/projects/save_config", {
						body: request,
					}),
				),
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
			updates: (project_id: string): Promise<ApiResult<TodoUpdate[]>> =>
				wrap(() =>
					this.clients.projects
						.get<{
							updates: TodoUpdate[];
						}>("/projects/updates", { query: { project_id } })
						.then((response) => response.updates),
				),

			/**
			 * Process scan results
			 */
			update: (project_id: string, data: ScanStatusUpdate): Promise<ApiResult<void>> =>
				wrap(() =>
					this.clients.projects.post("/projects/scan_status", {
						query: { project_id },
						body: data,
					}),
				),
		},

		/**
		 * Get project history
		 */
		history: (project_id: string): Promise<ApiResult<HistoryAction[]>> =>
			wrap(() => this.clients.projects.get<HistoryAction[]>(`/projects/${project_id}/history`)),

		/**
		 * Legacy methods (keeping for compatibility)
		 */
		upsert: (data: UpsertProject): Promise<ApiResult<Project>> =>
			wrap(() => this.clients.projects.patch<Project>("/projects", { body: data })),

		/**
		 * Fetch project specification from GitHub
		 */
		specification: (project_id: string): Promise<ApiResult<string>> =>
			wrap(() =>
				this.clients.projects.get<string>("/projects/fetch_spec", {
					query: { project_id },
				}),
			),

		/**
		 * Delete project (soft delete)
		 */
		deleteProject: (project: Project): Promise<ApiResult<void>> =>
			wrap(() =>
				this.clients.projects.patch("/projects", {
					body: { ...project, deleted: true },
				}),
			),
	};

	/**
	 * Milestones namespace with Result-wrapped operations
	 */
	public readonly milestones = {
		/**
		 * List milestones for authenticated user
		 */
		list: (): Promise<ApiResult<Milestone[]>> => wrap(() => this.clients.milestones.get<Milestone[]>("/milestones")),

		/**
		 * Get milestones by project ID
		 */
		getByProject: (project_id: string): Promise<ApiResult<Milestone[]>> =>
			wrap(() => this.clients.milestones.get<Milestone[]>(`/projects/${project_id}/milestones`)),

		/**
		 * Get milestone by ID
		 */
		find: (id: string): Promise<ApiResult<Milestone | null>> =>
			wrap(async () => {
				try {
					return await this.clients.milestones.get<Milestone>(`/milestones/${id}`);
				} catch {
					return null;
				}
			}),

		/**
		 * Create new milestone
		 */
		create: (data: {
			project_id: string;
			name: string;
			description?: string | null;
			target_time?: string | null;
			target_version?: string | null;
			finished_at?: string | null;
		}): Promise<ApiResult<Milestone>> => wrap(() => this.clients.milestones.post<Milestone>("/milestones", { body: data })),

		/**
		 * Update milestone
		 */
		update: async (
			id: string,
			data: {
				name?: string;
				description?: string | null;
				target_time?: string | null;
				target_version?: string | null;
				finished_at?: string | null;
			},
		): Promise<ApiResult<Milestone>> =>
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
					finished_at: data.finished_at !== undefined ? data.finished_at : milestone.finished_at,
				};

				return this.clients.milestones.patch<Milestone>(`/milestones/${id}`, {
					body: updateData,
				});
			}),

		/**
		 * Delete milestone (soft delete)
		 */
		delete: (id: string): Promise<ApiResult<{ success: boolean; message: string }>> =>
			wrap(() => this.clients.milestones.delete<{ success: boolean; message: string }>(`/milestones/${id}`)),

		/**
		 * Get goals for a milestone
		 */
		goals: (id: string): Promise<ApiResult<Goal[]>> =>
			wrap(() => this.clients.milestones.get<Goal[]>(`/milestones/${id}/goals`)),
	};

	/**
	 * Goals namespace with Result-wrapped operations
	 */
	public readonly goals = {
		/**
		 * List goals for authenticated user
		 */
		list: (): Promise<ApiResult<Goal[]>> => wrap(() => this.clients.goals.get<Goal[]>("/goals")),

		/**
		 * Get goal by ID
		 */
		find: (id: string): Promise<ApiResult<Goal | null>> => wrap(() => this.clients.goals.get<Goal | null>(`/goals/${id}`)),

		/**
		 * Create new goal
		 */
		create: (data: {
			milestone_id: string;
			name: string;
			description?: string | null;
			target_time?: string | null;
			finished_at?: string | null;
		}): Promise<ApiResult<Goal>> => wrap(() => this.clients.goals.post<Goal>("/goals", { body: data })),

		/**
		 * Update goal
		 */
		update: async (
			id: string,
			data: { name?: string; description?: string | null; target_time?: string | null; finished_at?: string | null },
		): Promise<ApiResult<Goal>> =>
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
					finished_at: data.finished_at !== undefined ? data.finished_at : goal.finished_at,
				};

				return this.clients.goals.patch<Goal>(`/goals/${id}`, {
					body: updateData,
				});
			}),

		/**
		 * Delete goal (soft delete)
		 */
		delete: (id: string): Promise<ApiResult<{ success: boolean; message: string }>> =>
			wrap(() => this.clients.goals.delete<{ success: boolean; message: string }>(`/goals/${id}`)),
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
		find: (id: string): Promise<ApiResult<TaskWithDetails | null>> =>
			wrap(() => this.clients.tasks.get<TaskWithDetails | null>("/tasks", { query: { id } })),

		/**
		 * Get tasks by project ID
		 */
		getByProject: (project_id: string): Promise<ApiResult<TaskWithDetails[]>> =>
			wrap(() =>
				this.clients.tasks.get<TaskWithDetails[]>(`/tasks`, {
					query: { project: project_id },
				}),
			),

		/**
		 * Create a new task
		 */
		create: (data: Omit<UpsertTodo, "id"> & { tags?: UpsertTag[] }): Promise<ApiResult<TaskWithDetails>> =>
			wrap(() => this.clients.tasks.patch<TaskWithDetails>("/tasks", { body: data })),

		/**
		 * Update an existing task
		 */
		update: async (
			id: string,
			changes: Partial<Omit<UpsertTodo, "id">> & { tags?: UpsertTag[] },
		): Promise<ApiResult<TaskWithDetails>> =>
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

				return this.clients.tasks.patch<TaskWithDetails>("/tasks", {
					body: updateData,
				});
			}),

		/**
		 * Upsert task (create or update)
		 */
		upsert: (data: UpsertTodo & { tags?: UpsertTag[] }): Promise<ApiResult<TaskWithDetails>> =>
			wrap(() => this.clients.tasks.patch<TaskWithDetails>("/tasks", { body: data })),

		/**
		 * Save tags for tasks
		 */
		saveTags: (data: UpsertTag[]): Promise<ApiResult<void>> =>
			wrap(() => this.clients.tasks.patch("/tasks/save_tags", { body: data })),

		/**
		 * Delete task (soft delete)
		 */
		deleteTask: (task: TaskWithDetails): Promise<ApiResult<void>> =>
			wrap(() =>
				this.clients.tasks.patch("/tasks", {
					body: { ...task.task, deleted: true },
				}),
			),

		/**
		 * Task history operations
		 */
		history: {
			/**
			 * Get task history by task ID
			 */
			get: (task_id: string): Promise<ApiResult<HistoryAction[]>> =>
				wrap(() => this.clients.tasks.get<HistoryAction[]>(`/tasks/history/${task_id}`)),
		},
	};

	/**
	 * Tags namespace with Result-wrapped operations
	 */
	public readonly tags = {
		/**
		 * List tags for authenticated user
		 */
		list: (): Promise<ApiResult<TagWithTypedColor[]>> =>
			wrap(() => this.clients.tags.get<TagWithTypedColor[]>("/tags")),
	};

	/**
	 * GitHub namespace with Result-wrapped operations
	 */
	public readonly github = {
		/**
		 * List repositories for authenticated user
		 */
		repos: (): Promise<ApiResult<GithubRepo[]>> => wrap(() => this.clients.github.get<GithubRepo[]>("/repos")),

		/**
		 * List branches for a GitHub repository
		 */
		branches: (owner: string, repo: string): Promise<ApiResult<GithubBranch[]>> =>
			wrap(() => this.clients.github.get<GithubBranch[]>(`/repos/${owner}/${repo}/branches`)),
	};

	public readonly blog = {
		posts: {
			list: (params?: Partial<PostListParams>): Promise<ApiResult<PostsResponse>> =>
				wrap(() => {
					const query: Record<string, string> = {};
					if (params?.category) query.category = params.category;
					if (params?.tag) query.tag = params.tag;
					if (params?.project) query.project = params.project;
					if (params?.status) query.status = params.status;
					if (params?.archived !== undefined) query.archived = String(params.archived);
					if (params?.limit) query.limit = String(params.limit);
					if (params?.offset !== undefined) query.offset = String(params.offset);
					if (params?.sort) query.sort = params.sort;
					return this.clients.blog.get<PostsResponse>("/blog/posts", Object.keys(query).length ? { query } : {});
				}),

			getBySlug: (slug: string): Promise<ApiResult<Post>> =>
				wrap(() => this.clients.blog.get<Post>(`/blog/posts/${slug}`)),

			create: (data: PostCreate): Promise<ApiResult<Post>> =>
				wrap(() => this.clients.blog.post<Post>("/blog/posts", { body: data })),

			update: (uuid: string, data: PostUpdate): Promise<ApiResult<Post>> =>
				wrap(() => this.clients.blog.put<Post>(`/blog/posts/${uuid}`, { body: data })),

			delete: (uuid: string): Promise<ApiResult<{ success: boolean }>> =>
				wrap(() => this.clients.blog.delete<{ success: boolean }>(`/blog/posts/${uuid}`)),

			versions: (uuid: string): Promise<ApiResult<{ versions: VersionInfo[] }>> =>
				wrap(() => this.clients.blog.get<{ versions: VersionInfo[] }>(`/blog/posts/${uuid}/versions`)),

			version: (uuid: string, hash: string): Promise<ApiResult<PostContent>> =>
				wrap(() => this.clients.blog.get<PostContent>(`/blog/posts/${uuid}/version/${hash}`)),

			restore: (uuid: string, hash: string): Promise<ApiResult<Post>> =>
				wrap(() => this.clients.blog.post<Post>(`/blog/posts/${uuid}/restore/${hash}`)),
		},

		tags: {
			list: (): Promise<ApiResult<{ tags: TagWithCount[] }>> =>
				wrap(() => this.clients.blog.get<{ tags: TagWithCount[] }>("/blog/tags")),

			getForPost: (uuid: string): Promise<ApiResult<{ tags: string[] }>> =>
				wrap(() => this.clients.blog.get<{ tags: string[] }>(`/blog/tags/posts/${uuid}/tags`)),

			setForPost: (uuid: string, tags: string[]): Promise<ApiResult<{ tags: string[] }>> =>
				wrap(() => this.clients.blog.put<{ tags: string[] }>(`/blog/tags/posts/${uuid}/tags`, { body: { tags } })),

			addToPost: (uuid: string, tags: string[]): Promise<ApiResult<{ tags: string[] }>> =>
				wrap(() => this.clients.blog.post<{ tags: string[] }>(`/blog/tags/posts/${uuid}/tags`, { body: { tags } })),

			removeFromPost: (uuid: string, tag: string): Promise<ApiResult<void>> =>
				wrap(() => this.clients.blog.delete(`/blog/tags/posts/${uuid}/tags/${tag}`)),
		},

		categories: {
			tree: (): Promise<ApiResult<{ categories: Category[] }>> =>
				wrap(() => this.clients.blog.get<{ categories: Category[] }>("/blog/categories")),

			create: (data: CategoryCreate): Promise<ApiResult<Category>> =>
				wrap(() => this.clients.blog.post<Category>("/blog/categories", { body: data })),

			update: (name: string, data: { name: string }): Promise<ApiResult<Category>> =>
				wrap(() =>
					this.clients.blog.put<Category>(`/blog/categories/${name}`, {
						body: data,
					}),
				),

			delete: (name: string): Promise<ApiResult<void>> =>
				wrap(() => this.clients.blog.delete(`/blog/categories/${name}`)),
		},

		tokens: {
			list: (): Promise<ApiResult<{ tokens: SanitizedToken[] }>> =>
				wrap(() => this.clients.blog.get<{ tokens: SanitizedToken[] }>("/blog/tokens")),

			create: (data: AccessKeyCreate): Promise<ApiResult<CreatedToken>> =>
				wrap(() => this.clients.blog.post<CreatedToken>("/blog/tokens", { body: data })),

			update: (id: string, data: AccessKeyUpdate): Promise<ApiResult<AccessKey>> =>
				wrap(() =>
					this.clients.blog.put<AccessKey>(`/blog/tokens/${id}`, {
						body: data,
					}),
				),

			delete: (id: string): Promise<ApiResult<void>> =>
				wrap(() => this.clients.blog.delete(`/blog/tokens/${id}`)),
		},
	};

	public readonly media = {
		profiles: {
			list: (): Promise<ApiResult<Profile[]>> =>
				wrap(async () => {
					const res = await this.clients.media.get<{ profiles: Profile[] }>("/profiles");
					return res.profiles;
				}),

			create: (data: CreateProfileInput): Promise<ApiResult<Profile>> =>
				wrap(() => this.clients.media.post<Profile>("/profiles", { body: data })),

			get: (id: string): Promise<ApiResult<Profile>> => wrap(() => this.clients.media.get<Profile>(`/profiles/${id}`)),

			update: (id: string, data: UpdateProfileInput): Promise<ApiResult<Profile>> =>
				wrap(() => this.clients.media.patch<Profile>(`/profiles/${id}`, { body: data })),

			delete: (id: string): Promise<ApiResult<{ success: boolean }>> =>
				wrap(() => this.clients.media.delete<{ success: boolean }>(`/profiles/${id}`)),

			filters: {
				list: (profile_id: string): Promise<ApiResult<ProfileFilter[]>> =>
					wrap(async () => {
						const res = await this.clients.media.get<{
							filters: ProfileFilter[];
						}>(`/profiles/${profile_id}/filters`);
						return res.filters;
					}),

				add: (profile_id: string, data: AddFilterInput): Promise<ApiResult<ProfileFilter>> =>
					wrap(() => this.clients.media.post<ProfileFilter>(`/profiles/${profile_id}/filters`, { body: data })),

				remove: (profile_id: string, filter_id: string): Promise<ApiResult<void>> =>
					wrap(() => this.clients.media.delete(`/profiles/${profile_id}/filters/${filter_id}`)),
			},

			timeline: (slug: string, params?: { limit?: number; before?: string }): Promise<ApiResult<Timeline>> =>
				wrap(() => {
					const query: Record<string, string> = {};
					if (params?.limit) query.limit = String(params.limit);
					if (params?.before) query.before = params.before;
					return this.clients.media.get<Timeline>(
						`/profiles/${slug}/timeline`,
						Object.keys(query).length ? { query } : {},
					);
				}),
		},

		connections: {
			list: (profile_id: string, options?: { include_settings?: boolean }): Promise<ApiResult<Account[]>> =>
				wrap(async () => {
					const query: Record<string, string> = { profile_id };
					if (options?.include_settings) query.include_settings = "true";
					const res = await this.clients.media.get<{ accounts: Account[] }>("/connections", { query });
					return res.accounts;
				}),

			create: (data: {
				profile_id: string;
				platform: string;
				access_token: string;
				refresh_token?: string;
				platform_user_id?: string;
				platform_username?: string;
				token_expires_at?: string;
			}): Promise<ApiResult<Account>> => wrap(() => this.clients.media.post<Account>("/connections", { body: data })),

			delete: (account_id: string): Promise<ApiResult<{ success: boolean }>> =>
				wrap(() => this.clients.media.delete<{ success: boolean }>(`/connections/${account_id}`)),

			refresh: (account_id: string): Promise<ApiResult<unknown>> =>
				wrap(() => this.clients.media.post<unknown>(`/connections/${account_id}/refresh`)),

			refreshAll: (): Promise<ApiResult<unknown>> => wrap(() => this.clients.media.post<unknown>("/connections/refresh-all")),

			updateStatus: (account_id: string, is_active: boolean): Promise<ApiResult<Account>> =>
				wrap(() =>
					this.clients.media.patch<Account>(`/connections/${account_id}`, {
						body: { is_active },
					}),
				),

			settings: {
				get: (account_id: string): Promise<ApiResult<PlatformSettings>> =>
					wrap(() => this.clients.media.get<PlatformSettings>(`/connections/${account_id}/settings`)),

				update: (account_id: string, settings: Record<string, unknown>): Promise<ApiResult<{ updated: boolean }>> =>
					wrap(() =>
						this.clients.media.put<{ updated: boolean }>(`/connections/${account_id}/settings`, {
							body: { settings },
						}),
					),
			},

			repos: (account_id: string): Promise<ApiResult<MediaGithubRepo[]>> =>
				wrap(async () => {
					const res = await this.clients.media.get<{ repos: MediaGithubRepo[] }>(
						`/connections/${account_id}/repos`,
					);
					return res.repos;
				}),

			subreddits: (account_id: string): Promise<ApiResult<string[]>> =>
				wrap(async () => {
					const res = await this.clients.media.get<{
						subreddits: string[];
						username: string;
					}>(`/connections/${account_id}/subreddits`);
					return res.subreddits;
				}),
		},

		credentials: {
			check: (
				platform: string,
				profile_id: string,
			): Promise<
				ApiResult<{
					exists: boolean;
					isVerified: boolean;
					clientId: string | null;
				}>
			> =>
				wrap(() =>
					this.clients.media.get<{
						exists: boolean;
						isVerified: boolean;
						clientId: string | null;
					}>(`/credentials/${platform}`, { query: { profile_id } }),
				),

			save: (
				platform: string,
				data: {
					profile_id: string;
					client_id: string;
					client_secret: string;
					redirect_uri?: string;
					reddit_username?: string;
				},
			): Promise<ApiResult<{ success: boolean; id: string }>> =>
				wrap(() =>
					this.clients.media.post<{ success: boolean; id: string }>(`/credentials/${platform}`, { body: data }),
				),

			delete: (platform: string, profile_id: string): Promise<ApiResult<{ success: boolean }>> =>
				wrap(() =>
					this.clients.media.delete<{ success: boolean }>(`/credentials/${platform}`, { query: { profile_id } }),
				),
		},

		timeline: {
			get: (user_id: string, params?: { from?: string; to?: string }): Promise<ApiResult<Timeline>> =>
				wrap(() => {
					const query: Record<string, string> = {};
					if (params?.from) query.from = params.from;
					if (params?.to) query.to = params.to;
					return this.clients.media.get<Timeline>(`/timeline/${user_id}`, Object.keys(query).length ? { query } : {});
				}),

			getRaw: (user_id: string, platform: string, account_id: string): Promise<ApiResult<unknown>> =>
				wrap(() =>
					this.clients.media.get<unknown>(`/timeline/${user_id}/raw/${platform}`, {
						query: { account_id },
					}),
				),
		},
	};

	/**
	 * User namespace with Result-wrapped operations
	 */
	public readonly activity = {
		ai: (options?: { limit?: number; since?: string }): Promise<ApiResult<{ sessions: unknown[] }>> =>
			wrap(() => {
				const query: Record<string, string> = {};
				if (options?.limit) query.limit = String(options.limit);
				if (options?.since) query.since = options.since;
				return this.clients.projects.get<{ sessions: unknown[] }>(
					"/activity/ai",
					Object.keys(query).length ? { query } : {},
				);
			}),
	};

	public readonly user = {
		/**
		 * Get user activity history
		 */
		history: (): Promise<ApiResult<HistoryAction[]>> => wrap(() => this.clients.auth.get<HistoryAction[]>("/user/history")),

		/**
		 * Update user preferences
		 */
		preferences: (
			data: { id: string; task_view: string },
		): Promise<ApiResult<{ id: string; name: string | null; task_view: string }>> =>
			wrap(() =>
				this.clients.auth.patch<{ id: string; name: string | null; task_view: string }>("/user/preferences", {
					body: data,
				}),
			),
	};

	/**
	 * Get request history for debugging
	 */
	public history() {
		return this.clients.projects.history();
	}

	/**
	 * Pulse analytics and monitoring namespace
	 */
	public readonly pulse = {
		/**
		 * Get summary analytics for a project
		 */
		summary: (input: {
			project_id: string;
			range: "24h" | "7d" | "30d" | "90d" | { from: number; to: number };
		}): Promise<ApiResult<unknown>> =>
			wrap(() =>
				this.clients.pulse.get<unknown>("/summary/:project_id".replace(":project_id", input.project_id), {
					query:
						typeof input.range === "string"
							? { range: input.range }
							: { from: String(input.range.from), to: String(input.range.to) },
				}),
			),

		/**
		 * List events for a project
		 */
		events: (input: {
			project_id: string;
			name?: string;
			level?: string;
			ts_from?: number;
			ts_to?: number;
			search?: string;
			limit?: number;
			cursor?: string;
		}): Promise<ApiResult<unknown>> =>
			wrap(() => {
				const query: Record<string, string> = {};
				if (input.name) query.name = input.name;
				if (input.level) query.level = input.level;
				if (typeof input.ts_from === "number") query.ts_from = String(input.ts_from);
				if (typeof input.ts_to === "number") query.ts_to = String(input.ts_to);
				if (input.search) query.search = input.search;
				if (input.limit) query.limit = String(input.limit);
				if (input.cursor) query.cursor = input.cursor;
				return this.clients.pulse.get<unknown>("/events/:project_id".replace(":project_id", input.project_id), { query });
			}),

		/**
		 * List error issues for a project
		 */
		errors: (input: {
			project_id: string;
			range: "24h" | "7d" | "30d" | "90d" | { from: number; to: number };
			group_by_fingerprint?: boolean;
		}): Promise<ApiResult<unknown>> =>
			wrap(() => {
				const query: Record<string, string> = {};
				if (typeof input.range === "string") {
					query.range = input.range;
				} else {
					query.from = String(input.range.from);
					query.to = String(input.range.to);
				}
				if (input.group_by_fingerprint) query.group_by_fingerprint = "true";
				return this.clients.pulse.get<unknown>("/errors/:project_id".replace(":project_id", input.project_id), { query });
			}),

		/**
		 * List logs for a project
		 */
		logs: (input: {
			project_id: string;
			range: "24h" | "7d" | "30d" | "90d" | { from: number; to: number };
			level?: string;
			search?: string;
		}): Promise<ApiResult<unknown>> =>
			wrap(() => {
				const query: Record<string, string> = {};
				if (typeof input.range === "string") {
					query.range = input.range;
				} else {
					query.from = String(input.range.from);
					query.to = String(input.range.to);
				}
				if (input.level) query.level = input.level;
				if (input.search) query.search = input.search;
				return this.clients.pulse.get<unknown>("/logs/:project_id".replace(":project_id", input.project_id), { query });
			}),

		/**
		 * Get latency metrics for a project
		 */
		latency: (input: {
			project_id: string;
			range: "24h" | "7d" | "30d" | "90d" | { from: number; to: number };
			route?: string;
			percentiles?: number[];
		}): Promise<ApiResult<unknown>> =>
			wrap(() => {
				const query: Record<string, string> = {};
				if (typeof input.range === "string") {
					query.range = input.range;
				} else {
					query.from = String(input.range.from);
					query.to = String(input.range.to);
				}
				if (input.route) query.route = input.route;
				if (input.percentiles && input.percentiles.length > 0) query.percentiles = input.percentiles.join(",");
				return this.clients.pulse.get<unknown>("/latency/:project_id".replace(":project_id", input.project_id), { query });
			}),

		/**
		 * Subscription management
		 */
		subs: {
			/**
			 * List subscriptions for a project
			 */
			list: (input: { project_id: string }): Promise<ApiResult<unknown[]>> =>
				wrap(() => this.clients.pulse.get<unknown[]>("/admin/subs", { query: { project_id: input.project_id } })),

			/**
			 * Create a subscription
			 */
			create: (input: {
				project_id: string;
				name: string;
				filter: Record<string, unknown>;
				channel: Record<string, unknown>;
				cooldown_seconds?: number;
			}): Promise<ApiResult<{ id: string }>> =>
				wrap(() =>
					this.clients.pulse.post<{ id: string }>("/admin/subs", {
						body: {
							project_id: input.project_id,
							name: input.name,
							filter: input.filter,
							channel: input.channel,
							cooldown_seconds: input.cooldown_seconds,
						},
					}),
				),

			/**
			 * Get a subscription by ID
			 */
			get: (id: string): Promise<ApiResult<unknown>> => wrap(() => this.clients.pulse.get<unknown>(`/admin/subs/${id}`)),

			/**
			 * Update a subscription
			 */
			update: (
				id: string,
				patch: Partial<{ name: string; filter: Record<string, unknown>; channel: Record<string, unknown>; cooldown_seconds: number }>,
			): Promise<ApiResult<unknown>> => wrap(() => this.clients.pulse.patch<unknown>(`/admin/subs/${id}`, { body: patch })),

			/**
			 * Delete a subscription
			 */
			delete: (id: string): Promise<ApiResult<{ success: boolean }>> =>
				wrap(() => this.clients.pulse.delete<{ success: boolean }>(`/admin/subs/${id}`)),
		},

		/**
		 * Ingest key management
		 */
		keys: {
			/**
			 * List ingest keys for a project
			 */
			list: (input: { project_id: string }): Promise<ApiResult<unknown[]>> =>
				wrap(() => this.clients.pulse.get<unknown[]>("/admin/keys", { query: { project_id: input.project_id } })),

			/**
			 * Create a new ingest key (returns plaintext only once)
			 */
			create: (input: {
				project_id: string;
				name?: string;
				rate_limit_per_min?: number;
			}): Promise<ApiResult<{ id: string; plaintext: string; project_id: string }>> =>
				wrap(() =>
					this.clients.pulse.post<{ id: string; plaintext: string; project_id: string }>("/admin/keys", {
						body: {
							project_id: input.project_id,
							name: input.name,
							rate_limit_per_min: input.rate_limit_per_min,
						},
					}),
				),

			/**
			 * Delete an ingest key
			 */
			delete: (id: string, input: { project_id: string }): Promise<ApiResult<{ success: boolean }>> =>
				wrap(() =>
					this.clients.pulse.delete<{ success: boolean }>(`/admin/keys/${id}`, {
						query: { project_id: input.project_id },
					}),
				),
		},
	};

	/**
	 * Pipelines namespace with Result-wrapped operations
	 */
	public readonly pipelines = {
		/**
		 * Dashboard namespace — Phase 2.D observability slice. Aggregates
		 * `pipeline_run`, `pipeline_stage_event`, and `pipeline_approval`
		 * for the project's pipeline_package(s) over `window_ms` and
		 * enriches the response with pulse `/summary` when configured.
		 *
		 * Lives at `GET /v1/pipelines/dashboard?project_id=...&window_ms=...`
		 * on the main worker (unified D1 binding — no orchestrator hop).
		 * Auth: session cookie + ownership check on the project_id.
		 * Cache: `public, max-age=30`.
		 */
		dashboard: {
			get: (input: {
				project_id: string;
				window_ms?: number;
			}): Promise<ApiResult<DashboardResponse & { pulse: Record<string, unknown> | null }>> => {
				const query: Record<string, string> = { project_id: input.project_id };
				if (input.window_ms !== undefined) query.window_ms = String(input.window_ms);
				return wrap(() =>
					this.clients.pipelines.get<DashboardResponse & { pulse: Record<string, unknown> | null }>(
						"/pipelines/dashboard",
						{ query },
					),
				);
			},
		},

		/**
		 * List pipeline runs ordered by `created_at` DESC. Optional filters
		 * narrow by package and/or status; `limit` defaults to 50 server-side
		 * and is capped at 200.
		 */
		list: (filter?: { package_id?: string; status?: string; limit?: number }): Promise<ApiResult<PipelineRun[]>> => {
			const query: Record<string, string> = {};
			if (filter?.package_id !== undefined) query.package_id = filter.package_id;
			if (filter?.status !== undefined) query.status = filter.status;
			if (filter?.limit !== undefined) query.limit = String(filter.limit);
			return wrap(() =>
				this.clients.pipelines.get<PipelineRun[]>("/runs", Object.keys(query).length > 0 ? { query } : undefined),
			);
		},

		/**
		 * Get a pipeline run by ID
		 */
		get: (run_id: string): Promise<ApiResult<PipelineRun>> =>
			wrap(() => this.clients.pipelines.get<PipelineRun>(`/runs/${run_id}`)),

		/**
		 * Create a new pipeline run
		 */
		create: (input: {
			package_id: string;
			version_set_id: string;
		}): Promise<ApiResult<{ run_id: string; status: string }>> =>
			wrap(() =>
				this.clients.pipelines.post<{ run_id: string; status: string }>("/runs", {
					body: input,
				}),
			),

		/**
		 * Approve a stage in a pipeline run
		 */
		approve: (
			run_id: string,
			input: { stage_name: string; decision: "approved" | "denied"; user_id: string; reason?: string },
		): Promise<ApiResult<void>> =>
			wrap(() =>
				this.clients.pipelines.post(`/runs/${run_id}/approve`, {
					body: input,
				}),
			),

		/**
		 * Cancel a pipeline run
		 */
		cancel: (run_id: string): Promise<ApiResult<void>> =>
			wrap(() => this.clients.pipelines.post(`/runs/${run_id}/cancel`, { body: {} })),

		/**
		 * Rollback a pipeline run
		 */
		rollback: (run_id: string): Promise<ApiResult<void>> =>
			wrap(() => this.clients.pipelines.post(`/runs/${run_id}/rollback`, { body: {} })),

		/**
		 * Stage-event namespace — Phase 2.C webhook ingestion + read-back.
		 *
		 * `ingest` posts a webhook event against an in-flight run; auth
		 * mode is the standard bearer/session header (admin bypass; session
		 * must carry `runs:events` and matching `package_id`). Server-side
		 * stamps `payload.source = "external"`. Idempotency: same
		 * `idempotency_key` + same payload returns `{ duplicated: true }`;
		 * same key + different payload returns a 400 validation_error.
		 *
		 * `list` is read-only and returns the run's events newest-first.
		 */
		events: {
			ingest: (
				run_id: string,
				input: { stage_name: string; kind: StageEventKind; payload?: unknown; idempotency_key: string },
			): Promise<ApiResult<{ event_id: string; duplicated: boolean }>> =>
				wrap(() =>
					this.clients.pipelines.post<{ event_id: string; duplicated: boolean }>(`/runs/${run_id}/events`, {
						body: input,
					}),
				),

			list: (run_id: string): Promise<ApiResult<PipelineStageEvent[]>> =>
				wrap(() => this.clients.pipelines.get<PipelineStageEvent[]>(`/runs/${run_id}/events`)),
		},

		/**
		 * Grants namespace
		 */
		grants: {
			/**
			 * List grants for a package
			 */
			list: (package_id?: string): Promise<ApiResult<PipelineGrant[]>> =>
				wrap(() =>
					this.clients.pipelines.get<PipelineGrant[]>("/grants", {
						query: package_id ? { package_id } : {},
					}),
				),

			/**
			 * Approve a grant
			 */
			approve: (grant_id: string, user_id: string): Promise<ApiResult<PipelineGrant>> =>
				wrap(() =>
					this.clients.pipelines.post<PipelineGrant>(`/grants/${grant_id}/approve`, {
						body: { user_id },
					}),
				),

			/**
			 * Deny a grant
			 */
			deny: (grant_id: string, user_id: string, reason?: string): Promise<ApiResult<{ success: boolean }>> =>
				wrap(() =>
					this.clients.pipelines.post<{ success: boolean }>(`/grants/${grant_id}/deny`, {
						body: { user_id, reason },
					}),
				),
		},

		/**
		 * Packages namespace — full CRUD over pipeline_package rows. Writes
		 * (create/update/delete) require the orchestrator bearer token; the
		 * HttpClient picks it up via the standard auth header injection.
		 */
		packages: {
			/**
			 * List packages, optionally filtered by linked devpad project.
			 * Packages with `project_id = null` are not yet linked.
			 */
			list: (filter?: { project_id?: string }): Promise<ApiResult<PipelinePackage[]>> => {
				const query: Record<string, string> = {};
				if (filter?.project_id !== undefined) query.project_id = filter.project_id;
				return wrap(() =>
					this.clients.pipelines.get<PipelinePackage[]>(
						"/packages",
						Object.keys(query).length > 0 ? { query } : undefined,
					),
				);
			},

			/**
			 * Get a single package by id
			 */
			get: (package_id: string): Promise<ApiResult<PipelinePackage>> =>
				wrap(() => this.clients.pipelines.get<PipelinePackage>(`/packages/${package_id}`)),

			/**
			 * Register a new pipeline package. `id` is canonically the same as
			 * `name` per existing convention but is supplied explicitly so the
			 * orchestrator can disambiguate renames without conflicts.
			 */
			create: (input: {
				id: string;
				name: string;
				owner_id: string;
				repo_url?: string | null;
				project_id?: string | null;
				default_template_ref?: string | null;
			}): Promise<ApiResult<PipelinePackage>> =>
				wrap(() => this.clients.pipelines.post<PipelinePackage>("/packages", { body: input })),

			/**
			 * Partially update a package row. Missing keys preserve existing
			 * values; explicit `null` clears the field.
			 */
			update: (
				package_id: string,
				input: {
					repo_url?: string | null;
					project_id?: string | null;
					default_template_ref?: string | null;
					script_name_overrides?: Record<string, string> | null;
				},
			): Promise<ApiResult<PipelinePackage>> =>
				wrap(() => this.clients.pipelines.patch<PipelinePackage>(`/packages/${package_id}`, { body: input })),

			/**
			 * Remove a package. Refuses (409) if pipeline_run rows still
			 * reference the package — clean up runs first.
			 */
			delete: (package_id: string): Promise<ApiResult<{ deleted: true }>> =>
				wrap(() => this.clients.pipelines.delete<{ deleted: true }>(`/packages/${package_id}`)),
		},

		/**
		 * Analysis-template namespace — admin-gated CRUD for the
		 * `pipeline_analysis_template` table. Phase 2.A surface; each
		 * call requires the orchestrator's bearer token (literal
		 * `PIPELINES_TOKEN`). `owner_id` is required on every operation
		 * — single-tenant today, but the column is in place so multi-user
		 * ACLs slot in later.
		 */
		analysis_templates: {
			/**
			 * List templates for an owner.
			 */
			list: (input: { owner_id: string }): Promise<ApiResult<PipelineAnalysisTemplate[]>> =>
				wrap(() =>
					this.clients.pipelines.get<PipelineAnalysisTemplate[]>("/analysis-templates", {
						query: { owner_id: input.owner_id },
					}),
				),

			/**
			 * Get a single template by id, scoped to its owner. 404 when
			 * unknown or owned by a different user.
			 */
			get: (id: string, input: { owner_id: string }): Promise<ApiResult<PipelineAnalysisTemplate>> =>
				wrap(() =>
					this.clients.pipelines.get<PipelineAnalysisTemplate>(`/analysis-templates/${id}`, {
						query: { owner_id: input.owner_id },
					}),
				),

			/**
			 * Create a new analysis template. `threshold_dsl` is parsed
			 * server-side; parse failure returns 400 `validation_error`
			 * with `field: "threshold_dsl"` and a descriptive message.
			 * `window_ms` defaults to 600_000 (10 min) when omitted.
			 */
			create: (input: {
				owner_id: string;
				name: string;
				threshold_dsl: string;
				query_dsl?: unknown;
				window_ms?: number;
			}): Promise<ApiResult<PipelineAnalysisTemplate>> =>
				wrap(() => this.clients.pipelines.post<PipelineAnalysisTemplate>("/analysis-templates", { body: input })),

			/**
			 * Partial patch — only the supplied fields are touched.
			 * Re-validates `threshold_dsl` when supplied; same
			 * `validation_error` shape as create on parse failure.
			 */
			update: (
				id: string,
				input: {
					owner_id: string;
					name?: string;
					threshold_dsl?: string;
					query_dsl?: unknown;
					window_ms?: number;
				},
			): Promise<ApiResult<PipelineAnalysisTemplate>> =>
				wrap(() =>
					this.clients.pipelines.patch<PipelineAnalysisTemplate>(`/analysis-templates/${id}`, { body: input }),
				),

			/**
			 * Hard-delete the template. Does NOT consult
			 * `pipeline_run.resolved_gates` — runs snapshot their gate
			 * template at resolve-time, so deletion never orphans
			 * in-flight runs.
			 */
			delete: (id: string, input: { owner_id: string }): Promise<ApiResult<{ deleted: true }>> =>
				wrap(() =>
					this.clients.pipelines.delete<{ deleted: true }>(`/analysis-templates/${id}`, {
						query: { owner_id: input.owner_id },
					}),
				),
		},

		/**
		 * OIDC trust-policy namespace — admin-gated CRUD for the
		 * `pipeline_oidc_trust` table. Phase 15.D surface; each call requires
		 * the orchestrator's bearer token (literal `PIPELINES_TOKEN`).
		 * `owner_id` is required on every operation — single-tenant today,
		 * but the column is in place so multi-user ACLs slot in later.
		 */
		oidc_trust: {
			/**
			 * List policies for an owner, ordered created_at DESC, id ASC —
			 * matches the trust-matcher resolution order so the management UI
			 * shows the policy that would be picked first.
			 */
			list: (input: { owner_id: string }): Promise<ApiResult<PipelineOidcTrust[]>> =>
				wrap(() =>
					this.clients.pipelines.get<PipelineOidcTrust[]>("/oidc-trust", { query: { owner_id: input.owner_id } }),
				),

			/**
			 * Get a single policy by id, scoped to its owner. 404 when
			 * unknown, soft-deleted, or owned by a different user.
			 */
			get: (id: string, input: { owner_id: string }): Promise<ApiResult<PipelineOidcTrust>> =>
				wrap(() =>
					this.clients.pipelines.get<PipelineOidcTrust>(`/oidc-trust/${id}`, { query: { owner_id: input.owner_id } }),
				),

			/**
			 * Create a new policy. Defaults per plan §I.5: `repo_pattern: "*"`,
			 * `allowed_actions: ["artifacts:upload","runs:start"]`,
			 * `session_ttl_seconds: 900`.
			 */
			create: (input: {
				owner_id: string;
				github_owner: string;
				expected_audience: string;
				provider?: "github";
				repo_pattern?: string;
				allowed_refs?: string[];
				allowed_environments?: string[];
				allowed_actions?: string[];
				session_ttl_seconds?: number;
			}): Promise<ApiResult<PipelineOidcTrust>> =>
				wrap(() => this.clients.pipelines.post<PipelineOidcTrust>("/oidc-trust", { body: input })),

			/**
			 * Partial patch — only the supplied fields are touched. Validation
			 * runs against the merged record server-side.
			 */
			update: (
				id: string,
				input: {
					owner_id: string;
					github_owner?: string;
					expected_audience?: string;
					repo_pattern?: string;
					allowed_refs?: string[];
					allowed_environments?: string[];
					allowed_actions?: string[];
					session_ttl_seconds?: number;
				},
			): Promise<ApiResult<PipelineOidcTrust>> =>
				wrap(() => this.clients.pipelines.patch<PipelineOidcTrust>(`/oidc-trust/${id}`, { body: input })),

			/**
			 * Soft-delete a policy (sets `deleted = true`; row preserved for
			 * audit). The matcher and management list both skip soft-deleted
			 * rows.
			 */
			delete: (id: string, input: { owner_id: string }): Promise<ApiResult<{ deleted: true }>> =>
				wrap(() =>
					this.clients.pipelines.delete<{ deleted: true }>(`/oidc-trust/${id}`, {
						query: { owner_id: input.owner_id },
					}),
				),
		},
	};

	/**
	 * Get the API key
	 */
	public getApiKey(): string {
		return this.api_key_field;
	}

	/**
	 * Get the authentication mode
	 */
	public getAuthMode(): AuthMode {
		return this.auth_mode_field;
	}
}
