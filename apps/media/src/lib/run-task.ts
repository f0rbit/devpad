/**
 * Run-and-report for Solid event handlers and lifecycle callbacks.
 *
 * `no-floating-promises` runs with `ignoreVoid: false` (verification
 * hardening 2.3a, incident #175), so a browser handler can neither float a
 * promise nor silence it with `void`. `run_task(promise, { component })`
 * attaches a rejection handler off the render loop and reports any
 * rejection through the structured logger — never swallows, returns `void`
 * so it fits sync handler positions.
 */
import { createLogger } from "@devpad/core/utils/logger";

const logger = createLogger("media:run-task");

export type RunTaskLogger = (message: string, err: unknown, attrs?: Record<string, unknown>) => void;

export type RunTaskOptions = {
	/** File-ish name of the calling component (e.g. "profile-editor"). */
	component: string;
	/** Optional handler name for components with several async actions. */
	action?: string;
	/** Test seam — defaults to the structured logger. */
	log?: RunTaskLogger;
};

const message_for = (opts: RunTaskOptions): string =>
	opts.action === undefined ? `${opts.component} task failed` : `${opts.component} ${opts.action} failed`;

export const run_task = (promise: Promise<unknown>, opts: RunTaskOptions): void => {
	const report = opts.log ?? logger.error;
	const message = message_for(opts);
	const attrs: Record<string, unknown> = { component: opts.component };
	if (opts.action !== undefined) attrs.action = opts.action;
	promise.then(
		() => {},
		(cause: unknown) => {
			report(message, cause, attrs);
		},
	);
};
