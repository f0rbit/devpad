import { and, desc, eq, sql } from "drizzle-orm";
import { db, action, ignore_path, project, tag, tag_config, todo_updates, tracker_result, type ActionType } from "@devpad/schema/database";
import type { TodoUpdate, TrackerResult, UpsertProject } from "@devpad/schema";

export async function getUserProjects(user_id: string) {
	return await db.select().from(project).where(eq(project.owner_id, user_id));
}

export type Project = Awaited<ReturnType<typeof getUserProjects>>[0];

export async function getProject(user_id: string, project_id: string) {
	try {
		const search = await db
			.select()
			.from(project)
			.where(and(eq(project.owner_id, user_id), eq(project.project_id, project_id)));
		if (!search || !search[0]) return { project: null, error: "Couldn't find project" };
		return { project: search[0], error: null };
	} catch (err) {
		console.error(err);
		return { project: null, error: "Internal Server Error" };
	}
}

export async function getProjectById(project_id: string) {
	if (!project_id) return { project: null, error: "No project ID" };
	try {
		const search = await db.select().from(project).where(eq(project.id, project_id));
		if (!search || !search[0]) return { project: null, error: "Couldn't find project" };
		return { project: search[0], error: null };
	} catch (err) {
		console.error(err);
		return { project: null, error: "Internal Server Error" };
	}
}

export async function getUserProjectMap(user_id: string) {
	const projects = await getUserProjects(user_id);
	const project_map = {} as Record<string, Project>;
	for (const p of projects) {
		project_map[p.id] = p;
	}
	return project_map;
}

export async function getRecentUpdate(project: Project) {
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

	const update = updates[0] as TodoUpdate & { old_data: TrackerResult | null; new_data: TrackerResult | null };
	update.old_data = null;
	update.new_data = null;

	// we need to append old and new data if they exist
	if (update.old_id) {
		const old = await db.select().from(tracker_result).where(eq(tracker_result.id, update.old_id));
		if (old && old[0]) update.old_data = old[0];
	}
	if (update.new_id) {
		const new_ = await db.select().from(tracker_result).where(eq(tracker_result.id, update.new_id));
		if (new_ && new_[0]) update.new_data = new_[0];
	}

	return update;
}

export async function doesUserOwnProject(user_id: string, project_id: string) {
	const { project, error } = await getProjectById(project_id);
	if (error) {
		console.error("Error finding project in doesUserOwnProject", error);
		return false;
	}
	if (!project) {
		// project not found
		return false;
	}

	return project.owner_id == user_id;
}

export async function addProjectAction({ owner_id, project_id, type, description }: { owner_id: string; project_id: string; type: ActionType; description: string }) {
	const data = { project_id };

	const user_owns = await doesUserOwnProject(owner_id, project_id);
	if (!user_owns) return false;

	// add the action
	await db.insert(action).values({ owner_id, type, description, data });

	console.log("inserted action", type);

	return true;
}

export async function getProjectConfig(project_id: string) {
	// Fetch project details
	const { project, error } = await getProjectById(project_id);
	if (error) return { config: null, id: null, scan_branch: null, error: `Error fetching project: ${error}` };
	if (!project) return { config: null, id: null, scan_branch: null, error: `Project not found` };

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

	let tags: { name: string; match: string[] }[] | null = null;
	try {
		tags = tag_result.map((row) => ({
			name: row.name,
			match: JSON.parse(row.matches || "[]") as string[],
		}));
	} catch (err) {
		return { config: null, id: null, scan_branch: null, error: "Error parsing tag matches" };
	}
	if (!tags) return { config: null, id: null, scan_branch: null, error: "Error fetching tags" };

	// Fetch ignore paths
	const ignore_result = await db.select({ path: ignore_path.path }).from(ignore_path).where(eq(ignore_path.project_id, project_id));

	const ignore = ignore_result.map((row) => row.path);

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

export type ProjectConfig = Awaited<ReturnType<typeof getProjectConfig>>;

export async function upsertProject(data: UpsertProject, owner_id: string, access_token?: string) {
	const previous = await (async () => {
		if (!data.id) return null;
		return (await getProjectById(data.id)).project ?? null;
	})();

	// authorise
	if (previous && previous.owner_id != owner_id) {
		throw new Error("Unauthorized: User does not own this project");
	}

	const final_owner_id = data.owner_id ?? previous?.owner_id ?? owner_id;

	if (!final_owner_id) {
		throw new Error("Bad Request: No owner_id provided");
	}

	const exists = !!previous;

	const github_linked = (data.repo_id && data.repo_url) || (previous?.repo_id && previous.repo_url);
	const repo_url = data.repo_url ?? previous?.repo_url;
	const fetch_specification = github_linked && repo_url && (!previous || !previous.specification);

	// the new_project is imported from github and doesn't have a specification, import it from the README
	if (fetch_specification && !data.specification && access_token) {
		console.log(`Updating specification for project: ${data.project_id ?? previous?.project_id}`);
		// we need to get OWNER and REPO from the repo_url
		const { getSpecification } = await import("./github");
		const slices = repo_url.split("/");
		const repo = slices.at(-1);
		const owner = slices.at(-2);
		if (!repo || !owner) throw new Error("Invalid repo_url");
		const readme = await getSpecification(owner, repo, access_token);
		data.specification = readme;
	}

	const upsert = {
		...data,
		id: (data.id == "" || data.id == null) ? undefined : data.id,
		updated_at: new Date().toISOString(),
		owner_id: final_owner_id
	}

	let res: Project[] | null = null;
	if (exists) {
		// perform update
		res = await db.update(project).set(upsert).where(eq(project.id, upsert.id!)).returning();
	} else {
		// perform insert
		res = await db
			.insert(project)
			.values(upsert)
			.onConflictDoUpdate({ target: [project.id], set: upsert })
			.returning();
	}
	if (!res || res.length != 1) throw new Error(`Project upsert returned incorrect rows (${res?.length ?? 0})`);

	const [new_project] = res;

	const project_id = new_project.id;

	// TODO: for project updates, include the changes as a diff in the data
	if (!exists) {
		// add CREATE_PROJECT action
		await addProjectAction({ owner_id: final_owner_id, project_id, type: "CREATE_PROJECT", description: "Created project" });
	} else if (data.specification) {
		// add UPDATE_PROJECT action with 'updated specification' description
		await addProjectAction({ owner_id: final_owner_id, project_id, type: "UPDATE_PROJECT", description: "Updated specification" });
	} else {
		// add UPDATE_PROJECT action
		await addProjectAction({ owner_id: final_owner_id, project_id, type: "UPDATE_PROJECT", description: "Updated project settings" });
	}

	return new_project;
}
