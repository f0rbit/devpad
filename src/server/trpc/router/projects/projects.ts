import { router, protectedProcedure as protectedProcedure } from "@/server/trpc/trpc";
import { PROJECT_STATUS } from "@prisma/client";
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
	}),
	createProject: protectedProcedure
		.input(
			z.object({
				project_id: z.string(),
				status: z.nativeEnum(PROJECT_STATUS),
				name: z.string(),
				description: z.string().optional(),
				link_url: z.string().optional(),
				link_text: z.string().optional(),
				icon_url: z.string().optional(),
				repo_url: z.string().optional()
			})
		)
		.mutation(async ({ ctx, input }) => {
			return await ctx.prisma.project.create({
				data: {
					...input,
					owner_id: ctx.session.user.id
				}
			});
		})
});
