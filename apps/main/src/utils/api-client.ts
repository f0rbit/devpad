import type ApiClient from "@devpad/api";
import type { ApiResultError } from "@devpad/api";
import { getServerApiClient } from "@devpad/core/ui/api-client";
import type { Project } from "@devpad/schema";

export function rethrow(error: ApiResultError) {
	return new Response(error?.code, { status: error?.status_code, statusText: error?.code });
}

type ProjectGuardOk = { client: ApiClient; project: Project; user: { id: string; github_id: number; name: string; task_view: "list" | "grid" } };

export async function getProject(astro: { params: Record<string, string | undefined>; locals: App.Locals }): Promise<ProjectGuardOk | Response> {
	const { project_id } = astro.params;
	if (!project_id) return new Response(null, { status: 404, statusText: "Project not found" });

	const user = astro.locals.user;
	if (!user) return new Response(null, { status: 401, statusText: "Unauthorized" });

	const client = getServerApiClient(astro.locals);
	const result = await client.projects.getByName(project_id);
	if (!result.ok) return rethrow(result.error);

	const project = result.value;
	if (!project) return new Response(null, { status: 404, statusText: "Project not found" });
	if (project.owner_id !== user.id) return new Response(null, { status: 403, statusText: "Access denied" });

	return { client, project, user };
}
