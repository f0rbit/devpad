import { createTask, deleteTask, updateTask, updateTaskValidation } from "@/server/api/tasks";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { createItemInput, FetchedTask, Module, TaskInclude } from "@/types/page-link";
import { contextUserOwnsTask, getDefaultModuleData } from "src/utils/backend";
import { z } from "zod";



export const taskRouter = router({
	getTasks: protectedProcedure.query(async ({ ctx }) => {
		return (await ctx.prisma.task.findMany({
			where: { owner_id: ctx.session.user.id },
			include: TaskInclude
		})) as FetchedTask[];
	}),

	updateItem: protectedProcedure.input(z.object({ item: updateTaskValidation })).mutation(async ({ ctx, input }) => {
		return await updateTask(input.item, ctx.session);
	}),
	createTask: protectedProcedure.input(z.object({ item: createItemInput })).mutation(async ({ ctx, input }) => {
		return await createTask(input.item, ctx.session);
	}),
	deleteItem: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
		return await deleteTask(input.id, ctx.session);
	}),
	addModule: protectedProcedure
		.input(
			z.object({
				task_id: z.string(),
				module_type: z.nativeEnum(Module)
			})
		)
		.mutation(async ({ ctx, input }) => {
			// check auth
			const owns = await contextUserOwnsTask(ctx, input.task_id);
			if (!owns) return false;
			await ctx.prisma.task.update({
				where: { id: input.task_id },
				data: {
					modules: {
						connectOrCreate: {
							where: {
								task_id_type: {
									task_id: input.task_id,
									type: input.module_type
								}
							},
							create: {
								type: input.module_type,
								data: getDefaultModuleData(input.module_type)
							}
						}
					}
				}
			});
			return await ctx.prisma.task.findUnique({
				where: { id: input.task_id },
				include: TaskInclude
			});
		}),
	updateModule: protectedProcedure
		.input(
			z.object({
				task_id: z.string(),
				modules: z.array(
					z.object({
						type: z.string(),
						data: z.any()
					})
				)
			})
		)
		.mutation(async ({ ctx, input }) => {
			const owns = await contextUserOwnsTask(ctx, input.task_id);
			if (!owns) return false;
			// update each module's data
			for (const module_input of input.modules) {
				await ctx.prisma.taskModule.update({
					where: {
						task_id_type: {
							task_id: input.task_id,
							type: module_input.type
						}
					},
					data: {
						data: module_input.data
					}
				});
			}
			return (await ctx.prisma.task.findUnique({
				where: { id: input.task_id },
				include: TaskInclude
			})) as FetchedTask;
		})
});
