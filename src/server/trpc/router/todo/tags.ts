import { router, protected_procedure } from "@/server/trpc/trpc";
import { z } from "zod";

const user_owns_tag = async (ctx: any, user_id: string, tag_id: string) => {
	if (!ctx.prisma) return false;
	const user = await ctx.prisma.taskTags.findFirst({
		where: {
			id: tag_id,
			owner_id: user_id
		}
	});
	return user ? true : false;
};

export const tagRouter = router({
	get_tags: protected_procedure.query(async ({ ctx }) => {
		return await ctx.prisma.taskTags.findMany({
			where: { owner_id: ctx.session.user.id }
		});
	}),
	create_tag: protected_procedure
		.input(z.object({ title: z.string(), colour: z.string() }))
		.mutation(async ({ ctx, input }) => {
			return await ctx.prisma.taskTags.create({
				data: {
					title: input.title,
					colour: input.colour,
					owner_id: ctx.session.user.id
				}
			});
		}),
	delete_tag: protected_procedure
		.input(z.object({ id: z.string() }))
		.mutation(async ({ ctx, input }) => {
			// check that owner owns the tag
			const owns = await user_owns_tag(ctx, ctx.session.user.id, input.id);
			if (!owns) return false;
			// delete the tag
			await ctx.prisma.taskTags.delete({
				where: { id: input.id }
			});
			return true;
		}),
	update_tag: protected_procedure
		.input(
			z.object({
				id: z.string(),
				title: z.string().optional(),
				colour: z.string().optional()
			})
		)
		.mutation(async ({ ctx, input }) => {
			// check that owner owns the tag
			const owns = await user_owns_tag(ctx, ctx.session.user.id, input.id);
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
