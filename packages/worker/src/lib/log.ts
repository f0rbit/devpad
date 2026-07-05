/**
 * Server-side pulse logger for the devpad worker.
 *
 * Mirrors `apps/main/src/lib/pulse.ts`'s `log` namespace so route handlers
 * call the same surface on both sides of the wire. Set as a request-scoped
 * context variable (`c.set("log", make_log(pulse))`) by the pulse middleware.
 * Falls back to `noop_log` when pulse isn't configured so routes never have
 * to null-check.
 *
 *   const log = c.get("log");
 *   log.info("user signed in", { user_id });
 *   log.error("payment failed", err, { order_id });   // err optional
 *   const span = log.span("github_scan"); ...; span.end({ items });
 */

import type { Pulse } from "@f0rbit/pulse-client";
import { startSpan, type Span } from "@f0rbit/pulse-client/spans";

type LogLevel = "raw" | "debug" | "info" | "notice" | "warning" | "error" | "critical";

const isError = (x: unknown): x is Error =>
	x instanceof Error || (typeof x === "object" && x !== null && "stack" in (x as Record<string, unknown>));

export type PulseLog = {
	raw(msg: string, attrs?: Record<string, unknown>): void;
	debug(msg: string, attrs?: Record<string, unknown>): void;
	info(msg: string, attrs?: Record<string, unknown>): void;
	notice(msg: string, attrs?: Record<string, unknown>): void;
	warning(msg: string, attrs?: Record<string, unknown>): void;
	/** `log.error(msg, err?, attrs?)` — Error promotes to a captured exception. */
	error(msg: string, err_or_attrs?: unknown, attrs?: Record<string, unknown>): void;
	/** `log.critical(msg, err?, attrs?)` — same shape, higher severity. */
	critical(msg: string, err_or_attrs?: unknown, attrs?: Record<string, unknown>): void;
	span(name: string): Span;
	trace(name: string, attrs?: Record<string, unknown>): void;
	flush(): Promise<void>;
};

const NOOP_SPAN: Span = { end: () => {} };

/** No-op logger for when pulse isn't configured (env vars unset). */
export const noop_log: PulseLog = {
	raw: () => {},
	debug: () => {},
	info: () => {},
	notice: () => {},
	warning: () => {},
	error: () => {},
	critical: () => {},
	span: () => NOOP_SPAN,
	trace: () => {},
	flush: async () => {},
};

const emit_level = (pulse: Pulse, level: LogLevel) => (msg: string, attrs?: Record<string, unknown>) => {
	pulse.log(level as never, msg, attrs);
};

const emit_error =
	(pulse: Pulse, level: "error" | "critical") =>
	(message: string, err_or_attrs?: unknown, attrs?: Record<string, unknown>): void => {
		if (isError(err_or_attrs)) {
			pulse.captureError(err_or_attrs, { message, level, ...attrs });
			return;
		}
		pulse.log(level, message, err_or_attrs as Record<string, unknown> | undefined);
	};

/** Build a `PulseLog` bound to a specific pulse instance. */
export const make_log = (pulse: Pulse): PulseLog => ({
	raw: emit_level(pulse, "raw"),
	debug: emit_level(pulse, "debug"),
	info: emit_level(pulse, "info"),
	notice: emit_level(pulse, "notice"),
	warning: emit_level(pulse, "warning"),
	error: emit_error(pulse, "error"),
	critical: emit_error(pulse, "critical"),
	span: (name: string) => startSpan({ pulse, name }),
	trace: (name: string, attrs?: Record<string, unknown>) => {
		startSpan({ pulse, name }).end(attrs);
	},
	flush: async () => {
		await pulse.flush();
	},
});
