import { Project } from "@prisma/client";
import { getCurrentUser } from "../session";

interface ErrorResponse {
	error: string;
}

export async function getUserProjects(): Promise<{ data: Project[]; error: string }> {
	const user = await getCurrentUser();
	if (!user || !user.id) return { data: [], error: "Not logged in!" };
	try {
		const projects = await prisma?.project.findMany({ where: { owner_id: user.id, deleted: false } });
		if (!projects) return { data: [], error: "No projects found!" };
		return { data: projects, error: "" };
	} catch (e: any) {
		var result = "Unknown error";
		if (typeof e === "string") {
			result = e.toUpperCase(); // works, `e` narrowed to string
		} else if (e instanceof Error) {
			result = e.message; // works, `e` narrowed to Error
		}
		return { error: result, data: [] };
	}
}

export async function getUserProject(projectID: string): Promise<{ data: Project | null; error: string }> {
	const user = await getCurrentUser();
	if (!user || !user.id) return { data: null, error: "Not logged in!" };
	try {
		const project = await prisma?.project.findUnique({ where: { owner_id_project_id: { owner_id: user.id, project_id: projectID } } });
		if (!project) return { data: null, error: "Project not found!" };
		return { data: project, error: "" };
	} catch (e: any) {
		var result = "Unknown error";
		if (typeof e === "string") {
			result = e.toUpperCase(); // works, `e` narrowed to string
		} else if (e instanceof Error) {
			result = e.message; // works, `e` narrowed to Error
		}
		return { error: result, data: null };
	}
}


