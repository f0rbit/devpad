import { router, publicProcedure } from "../trpc";
import { z } from "zod";
import { TODO_STATUS, TODO_VISBILITY } from "@prisma/client";

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
    updateItem: publicProcedure
        .input(
            z.object({
                id: z.string(),
                item: z.object({
                    title: z.string().optional(),
                    description: z.string().optional(),
                    progress: z.nativeEnum(TODO_STATUS).optional(),
                    summary: z.string().optional(),
                    visibility: z.nativeEnum(TODO_VISBILITY).optional(),
                    start_time: z.date().optional(),
                    end_time: z.date().optional(),
                })
            })
        )
        .mutation(async ({ ctx, input }) => {
            if (ctx?.session?.user?.id) {
                return ctx.prisma.tODO_Item.update({
                    where: {
                        id: input.id
                    },
                    data: {
                        ...input.item
                    }
                });
            } else {
                return null;
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
