import { Context } from "@/server/trpc/context";
import { Module, TaskPriority } from "@/types/page-link";

export const contextUserOwnsTag = async (ctx: Context, tagID: string) => {
	if (!ctx.prisma) return false;
	const tag = await ctx.prisma.taskTags.findFirst({
		where: {
			id: tagID
		}
	});
	return tag?.owner_id == ctx.session?.user?.id;
};

export const contextUserOwnsTask = async (ctx: Context, taskID: string) => {
	if (!ctx.prisma) return false;
	const task = await ctx.prisma.task.findFirst({
		where: {
			id: taskID
		}
	});
	return task?.owner_id == ctx.session?.user?.id;
};

export const getDefaultModuleData = (module: Module) => {
	switch (module) {
		case Module.END_DATE:
		case Module.START_DATE:
			return {
				date: new Date().toISOString()
			};
		case Module.PRIORITY:
			return {
				priority: TaskPriority.MEDIUM
			};
		case Module.CHECKLIST: {
			return {
				items: []
			};
		}
		case Module.SUMMARY: {
			return {
				summary: ""
			};
		}
		case Module.DESCRIPTION: {
			return {
				description: []
			};
		}
		default:
			return {};
	}
};
