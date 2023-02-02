import { router, protectedProcedure as protectedProcedure } from "@/server/trpc/trpc";
import { FetchedTask, TaskInclude } from "src/utils/trpc";

export const dataRouter = router({
    // get all items and tags
    getItemsAndTags: protectedProcedure.query(async ({ ctx }) => {
        return {
            items: await ctx.prisma.task.findMany({
                where: { owner_id: ctx.session.user.id },
                include: TaskInclude
            }) as FetchedTask[],
            tags: await ctx.prisma.taskTags.findMany({
                where: { owner_id: ctx.session.user.id }
            })
        };
    })
})