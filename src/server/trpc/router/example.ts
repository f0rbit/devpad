import { router, publicProcedure } from "../trpc";
import { z } from "zod";
import { TODO_STATUS } from "@prisma/client";

export const todoRouter = router({
    // hello: publicProcedure
    //     .input(z.object({ text: z.string().nullish() }).nullish())
    //     .query(({ input }) => {
    //         return {
    //             greeting: `Hello ${input?.text ?? "world"}`
    //         };
    //     }),
    getAll: publicProcedure.query(({ ctx }) => {
        console.log("next session", ctx.session);
        if (ctx?.session?.user?.id) {
            return ctx.prisma.tODO_Item.findMany({
                where: {
                    owner_id: ctx.session.user.id
                },
                include: {
                    tags: true,
                    children: true,
                    parents: true,
                    templates: true
                }
            });
        } else {
            return [];
        }
    }),
    updateProgress: publicProcedure
        .input(
            z.object({
                item_id: z.string(),
                progress: z.enum([
                    TODO_STATUS.COMPLETED,
                    TODO_STATUS.IN_PROGRESS,
                    TODO_STATUS.UNSTARTED
                ])
            })
        )
        .mutation(({ ctx, input }) => {
            return ctx.prisma.tODO_Item.update({
                where: {
                    id: input.item_id
                },
                data: {
                    progress: input.progress
                }
            });
        })
});
