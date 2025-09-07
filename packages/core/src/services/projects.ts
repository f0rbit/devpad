import type { Project, ProjectConfig, TodoUpdate, TrackerResult, UpsertProject } from "@devpad/schema";
import type { ActionType } from "@devpad/schema/database";
import { db, project, action, ignore_path, tag, tag_config, todo_updates, tracker_result } from "@devpad/schema/database/server";
import { and, desc, eq, sql } from "drizzle-orm";

export async function getUserProjects(user_id: string): Promise<Project[]> {
	const result = await db.select().from(project).where(eq(project.owner_id, user_id));
	return result;
}

export async function getProject(user_id: string, project_id: string): Promise<{ project: Project | null; error: string | null }> {
	try {
		const result = await db
			.select()
			.from(project)
			.where(and(eq(project.owner_id, user_id), eq(project.project_id, project_id)));

		if (!result || result.length === 0) {
			return { project: null, error: "Couldn't find project" };
		}

		return { project: result[0], error: null };
	} catch (err) {
		return { project: null, error: "Internal Server Error" };
	}
}

export async function getProjectById(project_id: string): Promise<{ project: Project | null; error: string | null }> {
	if (!project_id) {
		return { project: null, error: "No project ID" };
	}

	try {
		const result = await db.select().from(project).where(eq(project.id, project_id));

		return { project: result[0] ?? null, error: null };
	} catch (err) {
		return { project: null, error: "Internal Server Error" };
	}
}

export async function getUserProjectMap(user_id: string): Promise<Record<string, Project>> {
	const projects = await getUserProjects(user_id);
	const project_map = {} as Record<string, Project>;
	for (const p of projects) {
		project_map[p.id] = p;
	}
	return project_map;
}

export async function doesUserOwnProject(user_id: string, project_id: string): Promise<boolean> {
	const result = await db
		.select()
		.from(project)
		.where(and(eq(project.id, project_id), eq(project.owner_id, user_id)));

	return result.length > 0;
}

export async function addProjectAction({ owner_id, project_id, type, description }: { owner_id: string; project_id: string; type: ActionType; description: string }): Promise<boolean> {
	const user_owns = await doesUserOwnProject(owner_id, project_id);
	if (!user_owns) return false;

	try {
		await db.insert(action).values({
			owner_id,
			type,
			description,
			data: JSON.stringify({ project_id }),
		});
		return true;
	} catch {
		return false;
	}
}

export async function getRecentUpdate(project: Project) {
	const { owner_id: user_id, id } = project;
	if (!user_id || !id) {
		return null;
	}

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

export async function getProjectConfig(project_id: string) {
	const { project: projectData, error } = await getProjectById(project_id);
	if (error)
		return {
			config: null,
			id: null,
			scan_branch: null,
			error: `Error fetching project: ${error}`,
		};
	if (!projectData)
		return {
			config: null,
			id: null,
			scan_branch: null,
			error: `Project not found`,
		};

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

	const ignore_result = await db
		.select({
			path: ignore_path.path,
		})
		.from(ignore_path)
		.where(eq(ignore_path.project_id, project_id));

	const ignore = ignore_result.map(row => row.path);

	return {
		id: project_id,
		config: {
			tags,
			ignore,
		},
		scan_branch: projectData.scan_branch,
		error: null,
	};
}

// ProjectConfig type is now imported from @devpad/schema

export async function upsertProject(data: UpsertProject, owner_id: string, access_token?: string): Promise<Project> {
	// Handle GitHub specification fetching if needed
	if (access_token) {
		const previous = data.id ? (await getProjectById(data.id)).project : null;
		const github_linked = (data.repo_id && data.repo_url) || (previous?.repo_id && previous.repo_url);
		const repo_url = data.repo_url ?? previous?.repo_url;
		const fetch_specification = github_linked && repo_url && (!previous || !previous.specification);

		// the new_project is imported from github and doesn't have a specification, import it from the README
		if (fetch_specification && !data.specification && access_token) {
			try {
				// we need to get OWNER and REPO from the repo_url
				const { getSpecification } = await import("./github");
				const slices = repo_url.split("/");
				const repo = slices.at(-1);
				const owner = slices.at(-2);
				if (!repo || !owner) throw new Error("Invalid repo_url");

				const readme = await getSpecification(owner, repo, access_token);
				data.specification = readme;
			} catch (error) {
				// Handle case where repository has no README or other GitHub API errors
				// Continue with project creation even if README fetch fails
				data.specification = null;
			}
		}
	}

	const previous = data.id ? (await getProjectById(data.id)).project : null;

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

	// Remove any null values that could cause database issues
	const cleanUpsert = Object.fromEntries(Object.entries(upsert).filter(([_, value]) => value !== null)) as typeof upsert;

	let result: Project | null = null;
	if (exists && cleanUpsert.id) {
		// Performing UPDATE operation
		const updateResult = await db
			.update(project)
			.set(cleanUpsert as any)
			.where(eq(project.id, cleanUpsert.id))
			.returning();
		result = updateResult[0] || null;
	} else {
		// Performing INSERT with conflict handling
		const insertResult = await db
			.insert(project)
			.values(cleanUpsert as any)
			.onConflictDoUpdate({
				target: [project.id],
				set: cleanUpsert as any,
			})
			.returning();

		result = insertResult[0] || null;
	}

	if (!result) {
		throw new Error("Project operation failed - no result returned");
	}

	const new_project = result;
	const project_id = new_project.id;

	// Add action logs
	if (!exists) {
		await addProjectAction({
			owner_id: final_owner_id,
			project_id,
			type: "CREATE_PROJECT",
			description: "Created project",
		});
	} else if (data.specification) {
		await addProjectAction({
			owner_id: final_owner_id,
			project_id,
			type: "UPDATE_PROJECT",
			description: "Updated specification",
		});
	} else {
		await addProjectAction({
			owner_id: final_owner_id,
			project_id,
			type: "UPDATE_PROJECT",
			description: "Updated project settings",
		});
	}

	return new_project;
}
