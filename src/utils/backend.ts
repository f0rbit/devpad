import { Context } from "@/server/trpc/context";

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