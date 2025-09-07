import type { TodoUpdate, TrackerResult, UpsertProject } from "@devpad/schema";
import { db, ignore_path, project, tag, tag_config, todo_updates, tracker_result } from "@devpad/schema/database/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { BaseRepository } from "./base-repository";
import { log } from "../utils/logger";

export type Project = typeof project.$inferSelect;

export class ProjectRepository extends BaseRepository<typeof project, Project, UpsertProject> {
	constructor() {
		super(project);
	}

	async getUserProjects(user_id: string): Promise<Project[]> {
		return this.findBy("owner_id", user_id);
	}

	async getProject(user_id: string, project_id: string): Promise<{ project: Project | null; error: string | null }> {
		try {
			const result = await this.findWhere([eq(project.owner_id, user_id), eq(project.project_id, project_id)]);

			if (!result || result.length === 0) {
				return { project: null, error: "Couldn't find project" };
			}

			return { project: result[0], error: null };
		} catch (err) {
			return { project: null, error: "Internal Server Error" };
		}
	}

	async getProjectById(project_id: string): Promise<{ project: Project | null; error: string | null }> {
		if (!project_id) {
			return { project: null, error: "No project ID" };
		}

		try {
			const result = await this.findById(project_id);
			// Not finding a project is not an error, just return null project
			return { project: result, error: null };
		} catch (err) {
			return { project: null, error: "Internal Server Error" };
		}
	}

	async getUserProjectMap(user_id: string): Promise<Record<string, Project>> {
		const projects = await this.getUserProjects(user_id);
		const project_map = {} as Record<string, Project>;
		for (const p of projects) {
			project_map[p.id] = p;
		}
		return project_map;
	}

	async doesUserOwnProject(user_id: string, project_id: string): Promise<boolean> {
		return this.checkOwnership(project_id, user_id);
	}

	async addProjectAction(actionData: { owner_id: string; project_id: string; type: any; description: string }): Promise<boolean> {
		const data = { project_id: actionData.project_id };

		const user_owns = await this.doesUserOwnProject(actionData.owner_id, actionData.project_id);
		if (!user_owns) return false;

		return this.addAction({
			owner_id: actionData.owner_id,
			type: actionData.type,
			description: actionData.description,
			data,
		});
	}

	async getRecentUpdate(project: Project) {
		const DEBUG_THIS = true;
		const { owner_id: user_id, id } = project;
		if (!user_id) {
			return null;
		}
		if (!id) {
			return null;
		}

		// get the most recent entry from todo_updates table
		const updates = await db
			.select()
			.from(todo_updates)
			.where(and(eq(todo_updates.project_id, id), eq(todo_updates.status, "PENDING")))
			.orderBy(desc(todo_updates.created_at))
			.limit(1);

		if (!updates || !updates[0]) {
			return null;
		}

		const update = updates[0] as TodoUpdate & {
			old_data: TrackerResult | null;
			new_data: TrackerResult | null;
		};
		update.old_data = null;
		update.new_data = null;

		// we need to append old and new data if they exist
		if (update.old_id) {
			const old = await db.select().from(tracker_result).where(eq(tracker_result.id, update.old_id));
			if (old?.[0]) update.old_data = old[0];
		}
		if (update.new_id) {
			const new_ = await db.select().from(tracker_result).where(eq(tracker_result.id, update.new_id));
			if (new_?.[0]) update.new_data = new_[0];
		}

		return update;
	}

	async getProjectConfig(project_id: string) {
		// Fetch project details
		const { project, error } = await this.getProjectById(project_id);
		if (error)
			return {
				config: null,
				id: null,
				scan_branch: null,
				error: `Error fetching project: ${error}`,
			};
		if (!project)
			return {
				config: null,
				id: null,
				scan_branch: null,
				error: `Project not found`,
			};

		// Fetch tags and their matches
		const tag_result = await db
			.select({
				tag_id: tag.id,
				name: tag.title,
				matches: sql<string>`json_group_array(${tag_config.match})`,
			})
			.from(tag_config)
			.innerJoin(tag, eq(tag.id, tag_config.tag_id))
			.where(eq(tag_config.project_id, project_id))
			.groupBy(tag.id);

		let tags:
			| {
					name: string;
					match: string[];
			  }[]
			| null = null;
		try {
			tags = tag_result.map(row => ({
				name: row.name,
				match: JSON.parse(row.matches || "[]") as string[],
			}));
		} catch (_err) {
			return {
				config: null,
				id: null,
				scan_branch: null,
				error: "Error parsing tag matches",
			};
		}
		if (!tags)
			return {
				config: null,
				id: null,
				scan_branch: null,
				error: "Error fetching tags",
			};

		// Fetch ignore paths
		const ignore_result = await db
			.select({
				path: ignore_path.path,
			})
			.from(ignore_path)
			.where(eq(ignore_path.project_id, project_id));

		const ignore = ignore_result.map(row => row.path);

		// Construct and return the configuration JSON
		return {
			id: project_id,
			config: {
				tags,
				ignore,
			},
			scan_branch: project.scan_branch,
			error: null,
		};
	}

	async upsertProject(data: UpsertProject, owner_id: string): Promise<Project> {
		log.projects("🗂️  [ProjectRepository] upsertProject called", {
			hasId: !!data.id,
			hasProjectId: !!data.project_id,
			projectId: data.project_id,
			id: data.id,
			name: data.name,
			ownerId: owner_id,
			dataOwnerId: data.owner_id,
		});

		log.projects("🔍 [ProjectRepository] Looking up previous project...");
		const previous = await (async () => {
			if (!data.id) {
				log.projects("📭 [ProjectRepository] No data.id provided, no previous project");
				return null;
			}
			log.projects("🔎 [ProjectRepository] Fetching existing project by ID:", data.id);
			const result = (await this.getProjectById(data.id)).project ?? null;
			if (result) {
				log.projects("✅ [ProjectRepository] Found existing project", {
					existingId: result.id,
					existingOwnerId: result.owner_id,
					existingProjectId: result.project_id,
				});
			} else {
				log.projects("📭 [ProjectRepository] No existing project found");
			}
			return result;
		})();

		// authorize
		if (previous && previous.owner_id !== owner_id) {
			log.projects("❌ [ProjectRepository] Authorization failed - owner mismatch", {
				previousOwnerId: previous.owner_id,
				requestOwnerId: owner_id,
			});
			throw new Error("Unauthorized: User does not own this project");
		}

		const final_owner_id = data.owner_id ?? previous?.owner_id ?? owner_id;
		log.projects("🔧 [ProjectRepository] Determined final owner_id:", final_owner_id);

		if (!final_owner_id) {
			log.projects("❌ [ProjectRepository] No owner_id available");
			throw new Error("Bad Request: No owner_id provided");
		}

		const exists = !!previous;
		log.projects("📊 [ProjectRepository] Project existence:", { exists, hasId: !!data.id });

		const upsert = {
			...data,
			id: data.id === "" || data.id == null ? undefined : data.id,
			updated_at: new Date().toISOString(),
			owner_id: final_owner_id,
		};

		// Remove any null values that could cause database issues
		const cleanUpsert = Object.fromEntries(Object.entries(upsert).filter(([_, value]) => value !== null)) as typeof upsert;

		log.projects("🧹 [ProjectRepository] Cleaned upsert data", {
			originalKeys: Object.keys(upsert),
			cleanedKeys: Object.keys(cleanUpsert),
			removedNulls: Object.keys(upsert).filter(key => upsert[key as keyof typeof upsert] === null),
		});

		log.projects("🔄 [ProjectRepository] Prepared upsert data", {
			hasCleanUpsertId: !!cleanUpsert.id,
			cleanUpsertProjectId: cleanUpsert.project_id,
			cleanUpsertName: cleanUpsert.name,
			cleanUpsertOwnerId: cleanUpsert.owner_id,
		});

		let result: Project | null = null;
		if (exists && cleanUpsert.id) {
			log.projects("🔄 [ProjectRepository] Performing UPDATE operation");
			try {
				result = await this.updateById(cleanUpsert.id, cleanUpsert);
				log.projects("✅ [ProjectRepository] UPDATE completed", {
					resultId: result?.id,
					resultName: result?.name,
				});
			} catch (error) {
				log.projects("💥 [ProjectRepository] UPDATE failed", {
					error: error instanceof Error ? error.message : String(error),
					stack: error instanceof Error ? error.stack : undefined,
				});
				throw error;
			}
		} else {
			log.projects("➕ [ProjectRepository] Performing INSERT with conflict handling");
			log.projects("📊 [ProjectRepository] Clean upsert data details:", {
				hasId: !!cleanUpsert.id,
				id: cleanUpsert.id,
				project_id: cleanUpsert.project_id,
				name: cleanUpsert.name,
				owner_id: cleanUpsert.owner_id,
				status: cleanUpsert.status,
				visibility: cleanUpsert.visibility,
				dataType: typeof cleanUpsert,
			});

			try {
				log.database("🔄 [ProjectRepository] Executing INSERT with conflict handling...");
				const res = await db
					.insert(project)
					.values(cleanUpsert as any)
					.onConflictDoUpdate({
						target: [project.id],
						set: cleanUpsert as any,
					})
					.returning();

				result = (res[0] as Project) || null;
				log.projects("✅ [ProjectRepository] INSERT completed", {
					resultId: result?.id,
					resultName: result?.name,
					resultProjectId: result?.project_id,
				});
			} catch (error) {
				log.projects("💥 [ProjectRepository] INSERT failed", {
					errorType: error instanceof Error ? error.constructor.name : typeof error,
					error: error instanceof Error ? error.message : String(error),
					stack: error instanceof Error ? error.stack : undefined,
				});

				// Log the exact values that were being inserted
				throw error;
			}
		}

		if (!result) {
			throw new Error("Project operation failed - no result returned");
		}

		const new_project = result;
		const project_id = new_project.id;

		// Add action logs
		if (!exists) {
			await this.addProjectAction({
				owner_id: final_owner_id,
				project_id,
				type: "CREATE_PROJECT",
				description: "Created project",
			});
		} else if (data.specification) {
			await this.addProjectAction({
				owner_id: final_owner_id,
				project_id,
				type: "UPDATE_PROJECT",
				description: "Updated specification",
			});
		} else {
			await this.addProjectAction({
				owner_id: final_owner_id,
				project_id,
				type: "UPDATE_PROJECT",
				description: "Updated project settings",
			});
		}

		return new_project;
	}
}

export const projectRepository = new ProjectRepository();
