// src/server/trpc/router/_app.ts
import { router } from "../trpc";
import { authRouter } from "./auth";
import { projectsRouter } from "./projects/projects";
import { dataRouter } from "./todo/data";
import { tagRouter } from "./todo/tags";
import { taskRouter } from "./todo/tasks";

export const appRouter = router({
	auth: authRouter,
	tasks: taskRouter,
	tags: tagRouter,
	data: dataRouter,
	projects: projectsRouter
});

// export type definition of API
export type AppRouter = typeof appRouter;
