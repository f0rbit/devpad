import { router, protectedProcedure } from "@/server/trpc/trpc";
import { z } from "zod";
import { TASK_PROGRESS, TASK_VISIBILITY } from "@prisma/client";
import { createItemInput, FetchedTask, Module, TaskInclude, TaskPriority } from "@/types/page-link";
import { contextUserOwnsTask, getDefaultModuleData } from "src/utils/backend";
import { createTask } from "@/server/api/tasks";

const updateItemInput = z.object({
	title: z.string(),
	progress: z.nativeEnum(TASK_PROGRESS).default(TASK_PROGRESS.UNSTARTED),
	visibility: z.nativeEnum(TASK_VISIBILITY).optional().default(TASK_VISIBILITY.PRIVATE),
	tags: z.array(z.string()).optional()
});

/** @deprecated - use createItemInput instead */
const createOldItemInput = z.object({
	title: z.string(),
	progress: z.nativeEnum(TASK_PROGRESS).default(TASK_PROGRESS.UNSTARTED),
	visibility: z.nativeEnum(TASK_VISIBILITY).optional().default(TASK_VISIBILITY.PRIVATE)
});


export const taskRouter = router({
	getTasks: protectedProcedure.query(async ({ ctx }) => {
		return (await ctx.prisma.task.findMany({
			where: { owner_id: ctx.session.user.id },
			include: TaskInclude
		})) as FetchedTask[];
	}),

	updateOldItem: protectedProcedure
		.input(
			z.object({
				id: z.string(),
				item: updateItemInput,
				modules: z
					.array(
						z.object({
							type: z.string(),
							data: z.any()
						})
					)
					.optional()
			})
		)
		.mutation(async ({ ctx, input }) => {
			// check if user owns task
			const owns = await contextUserOwnsTask(ctx, input.id);
			if (!owns) return null;
			var tags: { set: { id: string }[] } | undefined = undefined;
			if (input.item.tags) {
				tags = {
					set: await ctx.prisma.taskTags.findMany({
						where: {
							id: {
								in: input.item.tags
							}
						},
						select: {
							id: true
						}
					})
				};
			}
			if (input.modules) {
				for (const module_input of input.modules) {
					await ctx.prisma.taskModule.update({
						where: {
							task_id_type: {
								task_id: input.id,
								type: module_input.type
							}
						},
						data: {
							data: module_input.data
						}
					});
				}	
			}
			return (await ctx.prisma.task.update({
				where: { id: input.id },
				data: {
					...input.item,
					tags
				},
				include: TaskInclude
			})) as FetchedTask;
		}),

	createItem: protectedProcedure.input(z.object({ item: createOldItemInput })).mutation(async ({ ctx, input }) => {
		return (await ctx.prisma.task.create({
			data: { ...input.item, owner_id: ctx.session.user.id },
			include: TaskInclude
		})) as FetchedTask;
	}),
	createTask: protectedProcedure.input(z.object({ item: createItemInput })).mutation(async ({ ctx, input }) => {
		return createTask(input.item, ctx.session);
	}),
	deleteItem: protectedProcedure
		.input(
			z.object({
				id: z.string()
			})
		)
		.mutation(async ({ ctx, input }) => {
			const owns = await contextUserOwnsTask(ctx, input.id);
			if (!owns) return false;
			await ctx.prisma.task.update({
				where: { id: input.id },
				data: { visibility: TASK_VISIBILITY.DELETED }
			});
			return true;
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
