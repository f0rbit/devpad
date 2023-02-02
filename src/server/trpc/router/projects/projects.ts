import { router, protectedProcedure as protectedProcedure } from "@/server/trpc/trpc";
import { z } from "zod";

export const projectsRouter = router({
	getProjects: protectedProcedure.query(async ({ ctx }) => {
		return await ctx.prisma.project.findMany({ where: { owner_id: ctx.session.user.id, deleted: false } });
	}),
	getProjectByID: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
		return await ctx.prisma.project.findUnique({
			where: {
				owner_id_project_id: {
					owner_id: ctx.session.user.id,
					project_id: input.id
				}
			}
		});
	})
});
