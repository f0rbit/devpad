import { getCurrentUser } from "../session";

export async function getUserProjects() {
	const user = await getCurrentUser();
    return await prisma?.project.findMany({
		where: {
			owner_id: user?.id
		}
	});
}

export async function getUserProject(userID: string, projectID: string) {
    return await prisma?.project.findUnique({
		where: {
			owner_id_project_id: {
				owner_id: userID,
				project_id: projectID
			}
		}
	});
}