import { router, protectedProcedure } from "@/server/trpc/trpc";
import { contextUserOwnsTag } from "src/utils/backend";
import { z } from "zod";

export const tagRouter = router({
	getTags: protectedProcedure.query(async ({ ctx }) => {
		return await ctx.prisma.taskTags.findMany({
			where: { owner_id: ctx.session.user.id }
		});
	}),
	createTag: protectedProcedure.input(z.object({ title: z.string(), colour: z.string() })).mutation(async ({ ctx, input }) => {
		const { title, colour } = input;
		return await ctx.prisma.taskTags.create({
			data: { title, colour, owner_id: ctx.session.user.id }
		});
	}),
	deleteTag: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
		const { id } = input;
		const owns = await contextUserOwnsTag(ctx, id);
		if (!owns) return false;
		await ctx.prisma.taskTags.delete({ where: { id } });
		return true;
	}),
	updateTag: protectedProcedure.input(z.object({ id: z.string(), title: z.string().optional(), colour: z.string().optional() })).mutation(async ({ ctx, input }) => {
		const { id, title, colour } = input;
		const owns = await contextUserOwnsTag(ctx, id);
		if (!owns) return null;
		return await ctx.prisma.taskTags.update({
			where: { id },
			data: { title, colour }
		});
	})
});
