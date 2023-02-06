import { CreateProjectType } from "@/types/page-link";
import { Session } from "next-auth";
import { getErrorMessage } from "src/utils/backend";

// create a project
export const createProject = async (project: CreateProjectType, session: Session): Promise<{ data: string | null; error: string | null }> => {
	if (!session?.user?.id) return { data: null, error: "You must be signed in to create a project." };
    try {
        const result = await prisma?.project.create({
            data: {
                ...project,
                owner_id: session?.user?.id
            },
            select: {
                project_id: true
            }
        });
        if (result?.project_id) {
            return {
                data: result.project_id,
                error: null
            };
        } else {
            return {
                data: null,
                error: "Project could not be created."
            };
        }
    } catch (err) {
        return {
            data: null,
            error: getErrorMessage(err)
        };
    }
};


export const deleteProject = async(project_id: string, session: Session): Promise<{ success: boolean; error: string | null }> => {
    if (!session?.user?.id) return { success: false, error: "You must be signed in to delete a project." };
    if (!project_id || project_id.length <= 0) return { success: false, error: "You must declare a valid project_id." };
    try {
        const result = await prisma?.project.update({
            where: {
                owner_id_project_id: {
                    owner_id: session?.user?.id,
                    project_id
                }
            },
            data: {
                deleted: true
            },
            select: {
                deleted: true
            }
        });
        if (result && result.deleted == true) {
            return {
                success: true,
                error: null
            };
        } else {
            return {
                success: false,
                error: "Project could not be deleted."
            };
        }
    } catch (err) {
        return {
            success: false,
            error: getErrorMessage(err)
        };
    }
}