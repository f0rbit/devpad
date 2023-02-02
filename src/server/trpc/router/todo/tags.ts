import { router, protectedProcedure as protectedProcedure } from "@/server/trpc/trpc";
import { contextUserOwnsTag } from "src/utils/backend";
import { z } from "zod";


export const tagRouter = router({
	getTags: protectedProcedure.query(async ({ ctx }) => {
		return await ctx.prisma.taskTags.findMany({
			where: { owner_id: ctx.session.user.id }
		});
	}),
	createTag: protectedProcedure.input(z.object({ title: z.string(), colour: z.string() })).mutation(async ({ ctx, input }) => {
		return await ctx.prisma.taskTags.create({
			data: {
				title: input.title,
				colour: input.colour,
				owner_id: ctx.session.user.id
			}
		});
	}),
	deleteTag: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
		// check that owner owns the tag
		const owns = await contextUserOwnsTag(ctx, input.id);
		if (!owns) return false;
		// delete the tag
		await ctx.prisma.taskTags.delete({
			where: { id: input.id }
		});
		return true;
	}),
	updateTag: protectedProcedure
		.input(
			z.object({
				id: z.string(),
				title: z.string().optional(),
				colour: z.string().optional()
			})
		)
		.mutation(async ({ ctx, input }) => {
			// check that owner owns the tag
			const owns = await contextUserOwnsTag(ctx, input.id);
			if (!owns) return null;
			// update the tag
			return await ctx.prisma.taskTags.update({
				where: { id: input.id },
				data: {
					title: input.title,
					colour: input.colour
				}
			});
		})
});
