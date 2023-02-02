import { router, protectedProcedure as protectedProcedure } from "@/server/trpc/trpc";
import { FetchedTask, TaskInclude } from "src/utils/trpc";

export const dataRouter = router({
	getItemsAndTags: protectedProcedure.query(async ({ ctx }) => {
		const where = { owner_id: ctx.session.user.id };
		return {
			items: (await ctx.prisma.task.findMany({ where, include: TaskInclude })) as FetchedTask[],
			tags: await ctx.prisma.taskTags.findMany({ where })
		};
	})
});
