// src/utils/trpc.ts
import superjson from "superjson";

import { httpBatchLink, loggerLink } from "@trpc/client";
import { createTRPCNext } from "@trpc/next";
import type { GetInferenceHelpers } from "@trpc/server";

import type { AppRouter } from "../server/trpc/router/_app";
import { createContext } from "@/server/trpc/context";

const getBaseUrl = () => {
	if (typeof window !== "undefined") return ""; // browser should use relative url
	if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`; // SSR should use vercel url
	if (process.env.ROOT_DOMAIN) return `https://${process.env.ROOT_DOMAIN}`; // SSR should use railway url
	return `http://${process.env.ROOT_DOMAIN}:${process.env.PORT ?? 3000}`; // dev SSR should use localhost
};

export const trpc = createTRPCNext<AppRouter>({
	config() {
		return {
			transformer: superjson,
			links: [
				loggerLink({
					enabled: (opts) => process.env.NODE_ENV === "development" || (opts.direction === "down" && opts.result instanceof Error)
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

