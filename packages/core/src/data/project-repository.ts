import type { TodoUpdate, TrackerResult, UpsertProject } from "@devpad/schema";
import { db, ignore_path, project, tag, tag_config, todo_updates, tracker_result } from "@devpad/schema/database/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { BaseRepository } from "./base-repository";

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
			console.error("Error getting project:", err);
			return { project: null, error: "Internal Server Error" };
		}
	}

	async getProjectById(project_id: string): Promise<{ project: Project | null; error: string | null }> {
		if (!project_id) {
			return { project: null, error: "No project ID" };
		}

		try {
			const result = await this.findById(project_id);
			if (!result) {
				return { project: null, error: "Couldn't find project" };
			}

			return { project: result, error: null };
		} catch (err) {
			console.error("Error getting project by ID:", err);
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
			if (DEBUG_THIS) console.error("No owner_id ID");
			return null;
		}
		if (!id) {
			if (DEBUG_THIS) console.error("No project ID");
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
			if (DEBUG_THIS) console.error("No updates found");
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
		const previous = await (async () => {
			if (!data.id) return null;
			return (await this.getProjectById(data.id)).project ?? null;
		})();

		// authorize
		if (previous && previous.owner_id !== owner_id) {
			throw new Error("Unauthorized: User does not own this project");
		}

		const final_owner_id = data.owner_id ?? previous?.owner_id ?? owner_id;

		if (!final_owner_id) {
			throw new Error("Bad Request: No owner_id provided");
		}

		const exists = !!previous;

		const upsert = {
			...data,
			id: data.id === "" || data.id == null ? undefined : data.id,
			updated_at: new Date().toISOString(),
			owner_id: final_owner_id,
		};

		let result: Project | null = null;
		if (exists && upsert.id) {
			// perform update
			result = await this.updateById(upsert.id, upsert);
		} else {
			// perform insert with conflict handling
			try {
				const res = await db
					.insert(project)
					.values(upsert as any)
					.onConflictDoUpdate({
						target: [project.id],
						set: upsert as any,
					})
					.returning();
				result = (res[0] as Project) || null;
			} catch (error) {
				console.error("Error upserting project:", error);
				throw error;
			}
		}

		if (!result) throw new Error("Project upsert failed");

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
