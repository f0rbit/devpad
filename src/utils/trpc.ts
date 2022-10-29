// src/utils/trpc.ts
import superjson from "superjson";

import { httpBatchLink, loggerLink } from "@trpc/client";
import { createTRPCNext } from "@trpc/next";
import type { GetInferenceHelpers } from "@trpc/server";

import type { AppRouter } from "../server/trpc/router/_app";
import { Task, TaskModule, TaskTags, TemplateTask } from "@prisma/client";

const getBaseUrl = () => {
	if (typeof window !== "undefined") return ""; // browser should use relative url
	if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`; // SSR should use vercel url
	return `http://devpad.local:${process.env.PORT ?? 3000}`; // dev SSR should use localhost
};

export const trpc = createTRPCNext<AppRouter>({
	config() {
		return {
			transformer: superjson,
			links: [
				loggerLink({
					enabled: (opts) =>
						process.env.NODE_ENV === "development" ||
						(opts.direction === "down" &&
							opts.result instanceof Error)
				}),
				httpBatchLink({
					url: `${getBaseUrl()}/api/trpc`
				})
			]
		};
	},
	ssr: false
});

/**
 * Inference helpers
 * @example type HelloOutput = AppRouterTypes['example']['hello']['output']
 **/
export type AppRouterTypes = GetInferenceHelpers<AppRouter>;

export const TaskInclude = {
	tags: true,
	templates: true,
	modules: true,
	parent: true,
	children: true
};

export type FetchedTask = Task & {
	tags: TaskTags[];
	templates: TemplateTask[];
	modules: TaskModule[];
	parent: Task;
	children: Task[];
};
