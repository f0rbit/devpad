import { router, protected_procedure } from "@/server/trpc/trpc";
import { z } from "zod";
import { TASK_PROGRESS, TASK_VISIBILITY } from "@prisma/client";
import { FetchedTask, TaskInclude } from "src/utils/trpc";

enum TASK_PRIORITY {
	LOW,
	MEDIUM,
	HIGH,
	URGENT
}

const user_owns_task = async (user_id: string, task_id: string) => {
	if (!prisma) return false;
	const user = await prisma.task.findFirst({
		where: {
			id: task_id,
			owner_id: user_id
		}
	});
	return user ? true : false;
};

const update_item_input = z.object({
	title: z.string(),
	progress: z.nativeEnum(TASK_PROGRESS).default(TASK_PROGRESS.UNSTARTED),
	visibility: z
		.nativeEnum(TASK_VISIBILITY)
		.optional()
		.default(TASK_VISIBILITY.PRIVATE)
});

export const taskRouter = router({
	get_tasks: protected_procedure.query(async ({ ctx }) => {
		return (await ctx.prisma.task.findMany({
			where: { owner_id: ctx.session.user.id },
			include: TaskInclude
		})) as FetchedTask[];
	}),
	update_item: protected_procedure
		.input(z.object({ id: z.string(), item: update_item_input }))
		.mutation(async ({ ctx, input }) => {
			const owns = await user_owns_task(ctx.session.user.id, input.id);
			if (!owns) return null;
			return (await ctx.prisma.task.update({
				where: { id: input.id },
				data: { ...input.item },
				include: TaskInclude
			})) as FetchedTask;
		}),
	create_item: protected_procedure
		.input(z.object({ item: update_item_input }))
		.mutation(async ({ ctx, input }) => {
			return (await ctx.prisma.task.create({
				data: { ...input.item, owner_id: ctx.session.user.id },
				include: TaskInclude
			})) as FetchedTask;
		}),

	delete_item: protected_procedure
		.input(
			z.object({
				id: z.string()
			})
		)
		.mutation(async ({ ctx, input }) => {
			const owns = await user_owns_task(ctx.session.user.id, input.id);
			if (!owns) return false;
			await ctx.prisma.task.update({
				where: { id: input.id },
				data: { visibility: TASK_VISIBILITY.DELETED }
			});
			return true;
		})
});
