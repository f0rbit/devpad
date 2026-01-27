import type { Result } from "@f0rbit/corpus";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppContext } from "../context";
import { errorMap } from "./errors";

export type Variables = {
	user: { id: string; github_id: number; name: string; task_view: "list" | "grid" } | null;
	blogContext: AppContext;
};

type ValidTarget = "query" | "param" | "json";
export const valid = <T>(c: Context, target: ValidTarget): T => (c.req.valid as (t: ValidTarget) => T)(target);

type MappableError = Parameters<typeof errorMap.response>[0];

export const response = {
	result: <T>(c: Context, result: Result<T, MappableError>, successStatus: ContentfulStatusCode = 200): Response => {
		if (!result.ok) {
			const { status, body } = errorMap.response(result.error);
			return c.json(body, status);
		}
		return c.json(result.value, successStatus);
	},
	with: <T, R>(c: Context, result: Result<T, MappableError>, mapper: (value: T) => R, successStatus: ContentfulStatusCode = 200): Response => {
		if (!result.ok) {
			const { status, body } = errorMap.response(result.error);
			return c.json(body, status);
		}
		return c.json(mapper(result.value), successStatus);
	},
	empty: <T>(c: Context, result: Result<T, MappableError>): Response => {
		if (!result.ok) {
			const { status, body } = errorMap.response(result.error);
			return c.json(body, status);
		}
		return c.body(null, 204);
	},
};
