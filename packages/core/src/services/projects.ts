import type { Project, ProjectConfig, TodoUpdate, TrackerResult, UpsertProject } from "@devpad/schema";
import type { ActionType } from "@devpad/schema/database";
import { action, ignore_path, project, tag, tag_config, todo_updates, tracker_result } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { err, ok, type Result } from "@f0rbit/corpus";
import { and, desc, eq, not, sql } from "drizzle-orm";
import type { ServiceError } from "./errors.js";

export async function getUserProjects(db: Database, user_id: string): Promise<Result<Project[], ServiceError>> {
	const result = await db
		.select()
		.from(project)
		.where(and(eq(project.owner_id, user_id), not(eq(project.visibility, "DELETED"))));
	return ok(result);
}

export async function getProject(db: Database, user_id: string, project_id: string): Promise<Result<Project, ServiceError>> {
	const result = await db
		.select()
		.from(project)
		.where(and(eq(project.owner_id, user_id), eq(project.project_id, project_id)));

	if (!result[0]) return err({ kind: "not_found", resource: "project", id: project_id });
	return ok(result[0]);
}

export async function getProjectById(db: Database, project_id: string): Promise<Result<Project, ServiceError>> {
	if (!project_id) return err({ kind: "validation", errors: { project_id: ["No project ID provided"] } });

	const result = await db.select().from(project).where(eq(project.id, project_id));
	if (!result[0]) return err({ kind: "not_found", resource: "project", id: project_id });
	return ok(result[0]);
}

export async function getUserProjectMap(db: Database, user_id: string): Promise<Result<Record<string, Project>, ServiceError>> {
	const projects_result = await getUserProjects(db, user_id);
	if (!projects_result.ok) return projects_result;

	const project_map = projects_result.value.reduce((acc, p) => ({ ...acc, [p.id]: p }), {} as Record<string, Project>);
	return ok(project_map);
}

export async function doesUserOwnProject(db: Database, user_id: string, project_id: string): Promise<Result<boolean, ServiceError>> {
	const result = await db
		.select()
		.from(project)
		.where(and(eq(project.id, project_id), eq(project.owner_id, user_id)));

	return ok(result.length > 0);
}

export async function addProjectAction(db: Database, { owner_id, project_id, type, description }: { owner_id: string; project_id: string; type: ActionType; description: string }): Promise<Result<boolean, ServiceError>> {
	const owns_result = await doesUserOwnProject(db, owner_id, project_id);
	if (!owns_result.ok) return owns_result;
	if (!owns_result.value) return ok(false);

	await db.insert(action).values({
		owner_id,
		type,
		description,
		data: JSON.stringify({ project_id }),
	});
	return ok(true);
}

export async function getRecentUpdate(db: Database, project_data: Project): Promise<Result<(TodoUpdate & { old_data: TrackerResult | null; new_data: TrackerResult | null }) | null, ServiceError>> {
	const { owner_id: user_id, id } = project_data;
	if (!user_id || !id) return ok(null);

	const updates = await db
		.select()
		.from(todo_updates)
		.where(and(eq(todo_updates.project_id, id), eq(todo_updates.status, "PENDING")))
		.orderBy(desc(todo_updates.created_at))
		.limit(1);

	if (!updates?.[0]) return ok(null);

	const update = updates[0] as TodoUpdate & { old_data: TrackerResult | null; new_data: TrackerResult | null };
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

	return ok(update);
}

export async function getProjectConfig(db: Database, project_id: string): Promise<Result<{ id: string; config: ProjectConfig; scan_branch: string | null }, ServiceError>> {
	const project_result = await getProjectById(db, project_id);
	if (!project_result.ok) return project_result;

	const project_data = project_result.value;

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

	const tags = tag_result.map((row: any) => ({
		name: row.name as string,
		match: JSON.parse(row.matches || "[]") as string[],
	}));

	const ignore_result = await db.select({ path: ignore_path.path }).from(ignore_path).where(eq(ignore_path.project_id, project_id));

	const ignore = ignore_result.map((row: any) => row.path as string);

	return ok({
		id: project_id,
		config: { tags, ignore },
		scan_branch: project_data.scan_branch,
	});
}

export type GitHubClient = {
	getRepoMetadata?: (owner: string, repo: string, access_token: string) => Promise<{ id: number }>;
	getSpecification?: (owner: string, repo: string, access_token: string) => Promise<string>;
};

export async function upsertProject(db: Database, data: UpsertProject, owner_id: string, access_token?: string, github_client?: GitHubClient): Promise<Result<Project, ServiceError>> {
	if (access_token && github_client) {
		const prev_result = data.id ? await getProjectById(db, data.id) : null;
		const previous = prev_result?.ok ? prev_result.value : null;
		const repo_url = data.repo_url ?? previous?.repo_url;

		if (repo_url && !data.repo_id && !previous?.repo_id && github_client.getRepoMetadata) {
			const url_parts = repo_url.replace(/\/$/, "").split("/");
			const repo = url_parts.at(-1);
			const owner = url_parts.at(-2);

			if (repo && owner) {
				const repo_data = await github_client.getRepoMetadata(owner, repo, access_token);
				data.repo_id = repo_data.id;
			}
		}

		const github_linked = (data.repo_id && data.repo_url) || (previous?.repo_id && previous?.repo_url);
		const fetch_specification = github_linked && repo_url && (!previous || !previous.specification);

		if (fetch_specification && !data.specification && github_client.getSpecification) {
			const slices = repo_url!.split("/");
			const repo = slices.at(-1);
			const owner = slices.at(-2);
			if (repo && owner) {
				data.specification = await github_client.getSpecification(owner, repo, access_token).catch(() => null);
			}
		}
	}

	const previous_result = data.id ? await getProjectById(db, data.id) : null;
	const previous = previous_result?.ok ? previous_result.value : null;

	if (previous && previous.owner_id !== owner_id) {
		return err({ kind: "forbidden", reason: "User does not own this project" });
	}

	const final_owner_id = data.owner_id ?? previous?.owner_id ?? owner_id;
	if (!final_owner_id) return err({ kind: "validation", errors: { owner_id: ["No owner_id provided"] } });

	const exists = !!previous;

	const { id: raw_id, ...fields } = data;
	const id = raw_id === "" || raw_id == null ? undefined : raw_id;
	const upsert = { ...fields, ...(id ? { id } : {}), updated_at: new Date().toISOString(), owner_id: final_owner_id };

	let result: Project | null = null;
	if (exists && id) {
		const update_result = await db.update(project).set(upsert).where(eq(project.id, id)).returning();
		result = update_result[0] || null;
	} else {
		const insert_result = await db
			.insert(project)
			.values(upsert)
			.onConflictDoUpdate({ target: [project.id], set: upsert })
			.returning();
		result = insert_result[0] || null;
	}

	if (!result) return err({ kind: "db_error", message: "Project operation failed - no result returned" });

	const new_project = result;
	const action_type: ActionType = !exists ? "CREATE_PROJECT" : "UPDATE_PROJECT";
	const action_desc = !exists ? "Created project" : data.specification ? "Updated specification" : "Updated project settings";

	await addProjectAction(db, {
		owner_id: final_owner_id,
		project_id: new_project.id,
		type: action_type,
		description: action_desc,
	});

	return ok(new_project);
}
