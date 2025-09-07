import type { UpsertProject } from "@devpad/schema";
import type { ActionType } from "@devpad/schema/database";
import { projectRepository, type Project } from "../data/project-repository";

export async function getUserProjects(user_id: string): Promise<Project[]> {
	return projectRepository.getUserProjects(user_id);
}

export type { Project };

export async function getProject(user_id: string, project_id: string): Promise<{ project: Project | null; error: string | null }> {
	return projectRepository.getProject(user_id, project_id);
}

export async function getProjectById(project_id: string): Promise<{ project: Project | null; error: string | null }> {
	return projectRepository.getProjectById(project_id);
}

export async function getUserProjectMap(user_id: string): Promise<Record<string, Project>> {
	return projectRepository.getUserProjectMap(user_id);
}

export async function getRecentUpdate(project: Project) {
	return projectRepository.getRecentUpdate(project);
}

export async function doesUserOwnProject(user_id: string, project_id: string): Promise<boolean> {
	return projectRepository.doesUserOwnProject(user_id, project_id);
}

export async function addProjectAction({ owner_id, project_id, type, description }: { owner_id: string; project_id: string; type: ActionType; description: string }): Promise<boolean> {
	return projectRepository.addProjectAction({ owner_id, project_id, type, description });
}

export async function getProjectConfig(project_id: string) {
	return projectRepository.getProjectConfig(project_id);
}

export type ProjectConfig = Awaited<ReturnType<typeof getProjectConfig>>;

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

	return projectRepository.upsertProject(data, owner_id);
}
