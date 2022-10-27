import { router, publicProcedure } from "../trpc";
import { z } from "zod";
import { TODO_Item, TODO_STATUS, TODO_VISBILITY } from "@prisma/client";

export const todoRouter = router({
	// hello: publicProcedure
	//     .input(z.object({ text: z.string().nullish() }).nullish())
	//     .query(({ input }) => {
	//         return {
	//             greeting: `Hello ${input?.text ?? "world"}`
	//         };
	//     }),
	getAll: publicProcedure.query(({ ctx }) => {
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
	getTags: publicProcedure.query(({ ctx }) => {
		if (ctx?.session?.user?.id) {
			return ctx.prisma.tODO_Tags.findMany({
				where: {
					owner_id: ctx.session.user.id
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
					title: z.string(),
					description: z.string(),
					progress: z.nativeEnum(TODO_STATUS),
					summary: z.string().optional(),
					visibility: z.nativeEnum(TODO_VISBILITY),
					start_time: z.date(),
					end_time: z.date().optional().nullish()
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

	createItem: publicProcedure
		.input(
			z.object({
				item: z.object({
					title: z.string(),
					description: z.string(),
					progress: z.nativeEnum(TODO_STATUS),
					summary: z.string().optional(),
					visibility: z.nativeEnum(TODO_VISBILITY),
					start_time: z.date(),
					end_time: z.date().optional().nullish()
				})
			})
		)
		.mutation(async ({ ctx, input }) => {
			if (ctx?.session?.user?.id) {
				const item = await ctx.prisma.tODO_Item.create({
					data: {
						...input.item,
						owner_id: ctx.session.user.id
					},
					include: {
						tags: true,
						children: true,
						parents: true,
						templates: true
					}
				});
				return {
					new_item: item
				};
			} else {
				return {
					new_item: null
				};
			}
		}),

	deleteItem: publicProcedure
		.input(
			z.object({
				id: z.string()
			})
		)
		.mutation(async ({ ctx, input }) => {
			if (ctx?.session?.user?.id) {
				// verify that user owns the todo item
				const item = await ctx.prisma.tODO_Item.findUnique({
					where: {
						id: input.id
					}
				});
				if (item?.owner_id === ctx.session.user.id) {
					await ctx.prisma.tODO_Item.update({
						where: {
							id: input.id
						},
						data: {
							visibility: TODO_VISBILITY.DELETED
						}
					});
					return {
						success: true
					};
				}
			}
			return {
				success: false
			};
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
		}),
	
});
