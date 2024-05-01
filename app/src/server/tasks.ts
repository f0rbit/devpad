import { eq, inArray } from "drizzle-orm";
import { codebase_tasks, task, task_tag } from "../../database/schema";
import { db } from "../../database/db";


export async function getUserTasks(user_id: string) {
	// pull from tasks, there are a couple things we will need to fetch as well
	// task could have multiple tags & checklists

	// fetch tasks left joining codebase on codebase_task_id
	const tasks = await db.select().from(task).leftJoin(codebase_tasks, eq(task.codebase_task_id, codebase_tasks.id)).where(eq(task.owner_id, user_id));

	// get all tags for each task
	const task_ids = tasks.map((t: any) => t.id);
	if (task_ids.length) {
		const tags = await db.select().from(task_tag).where(inArray(task_tag.task_id, task_ids));
		tasks.forEach((t: any) => {
			t.tags = tags.filter((tag: any) => tag.task_id === t.id);
		});
	}

	return tasks;
}
