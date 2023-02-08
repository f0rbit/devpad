import { CreateItemOptions } from "@/types/page-link";
import { Session } from "next-auth";
import { getErrorMessage } from "src/utils/backend";
import { FetchedTask, TaskInclude } from "src/utils/trpc";

export async function createTask(task: CreateItemOptions, session: Session): Promise<{ data: FetchedTask | null; error: string | null }> {
	if (!session?.user?.id) return { data: null, error: "You must be signed in to create a project." };
    /** @todo if the task has a goal_id, verify that the user owns that goal. */
	try {
		const fetchedTask = (await prisma?.task.create({
			data: {
				title: task.title,
                owner_id: session?.user?.id,
                visibility: task?.visibility,
                progress: task?.progress,
                project_goal_id: task.goal_id,
			},
            include: TaskInclude
		})) ?? { fetchedTask: null };
		if (!fetchedTask) return { data: null, error: "Project could not be created." };
		// createAction({ description: `Created project ${project.name}`, type: ACTION_TYPE.CREATE_PROJECT, owner_id: session?.user?.id, data: { project_id } }); // writes na action as history
		return { data: fetchedTask as FetchedTask, error: null };
	} catch (err) {
		return {
			data: null,
			error: getErrorMessage(err)
		};
	}
}