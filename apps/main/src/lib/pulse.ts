/**
 * Pulse analytics + observability for the devpad frontend.
 *
 * Opinionated severity ladder (low → high):
 *   raw → debug → info → notice → warning → error → critical
 *
 * Usage:
 *   import { log, track } from "@/lib/pulse";
 *
 *   log.info("user signed in", { user_id });
 *   log.warning("rate limit hit", { ip });
 *   log.error("payment failed", err, { order_id });   // err optional; Error promotes to a captured exception
 *   log.critical("db unreachable", err);
 *
 *   const span = log.span("fetch_dashboard");
 *   // ... do work
 *   span.end({ items: 12 });
 *
 *   log.trace("quick_check", { ms: 4 });              // one-shot span
 *   await log.flush();                                // before navigation/unload
 *
 *   track("project_created", { project_id });         // domain event (separate from logs)
 *
 * Init is lazy — no-ops cleanly when PUBLIC_PULSE_INGEST_URL / PUBLIC_DEVPAD_PROJECT_ID /
 * PUBLIC_DEVPAD_PULSE_INGEST_KEY are unset. Browser error handlers attach on first init.
 * Importing this module in a browser context eagerly initializes — no manual call needed.
 */

import { createPulse, type Pulse } from "@f0rbit/pulse-client";
import { startSpan, type Span } from "@f0rbit/pulse-client/spans";

type LogLevel = "raw" | "debug" | "info" | "notice" | "warning" | "error" | "critical";

let pulse_instance: Pulse | null = null;
let initialized = false;
let handlers_installed = false;

const ensureInitialized = (): Pulse | null => {
	if (initialized) return pulse_instance;
	initialized = true;

	if (typeof window === "undefined") return null;

	const endpoint = import.meta.env.PUBLIC_PULSE_INGEST_URL as string | undefined;
	const project_id = import.meta.env.PUBLIC_DEVPAD_PROJECT_ID as string | undefined;
	const ingest_key = import.meta.env.PUBLIC_DEVPAD_PULSE_INGEST_KEY as string | undefined;
	const release = import.meta.env.PUBLIC_GIT_SHA as string | undefined;

	if (!endpoint || !project_id || !ingest_key) return null;

	pulse_instance = createPulse({
		project_id,
		ingest_key,
		endpoint,
		auto_pageview: true,
		release,
	});

	install_browser_handlers(pulse_instance);
	return pulse_instance;
};

const install_browser_handlers = (p: Pulse): void => {
	if (handlers_installed || typeof window === "undefined") return;
	handlers_installed = true;

	window.addEventListener("error", (e: ErrorEvent) => {
		p.captureError(e.error ?? new Error(e.message), {
			source: "window.onerror",
			filename: e.filename,
			lineno: e.lineno,
			colno: e.colno,
		});
	});
	window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
		p.captureError(e.reason ?? new Error("unhandledrejection"), {
			source: "unhandledrejection",
		});
	});
};

const isError = (x: unknown): x is Error =>
	x instanceof Error || (typeof x === "object" && x !== null && "stack" in (x as Record<string, unknown>));

const emit = (level: LogLevel, message: string, attrs?: Record<string, unknown>): void => {
	ensureInitialized()?.log(level as never, message, attrs);
};

const error_or_critical =
	(level: "error" | "critical") =>
	(message: string, err_or_attrs?: unknown, attrs?: Record<string, unknown>): void => {
		const p = ensureInitialized();
		if (!p) return;
		if (isError(err_or_attrs)) {
			p.captureError(err_or_attrs, { message, level, ...attrs });
			return;
		}
		p.log(level, message, err_or_attrs as Record<string, unknown> | undefined);
	};

/** Opinionated namespaced log surface — see file header for the severity ladder. */
export const log = {
	raw: (msg: string, attrs?: Record<string, unknown>) => emit("raw", msg, attrs),
	debug: (msg: string, attrs?: Record<string, unknown>) => emit("debug", msg, attrs),
	info: (msg: string, attrs?: Record<string, unknown>) => emit("info", msg, attrs),
	notice: (msg: string, attrs?: Record<string, unknown>) => emit("notice", msg, attrs),
	warning: (msg: string, attrs?: Record<string, unknown>) => emit("warning", msg, attrs),
	/** `log.error(msg, err?, attrs?)` — when an Error is passed it's captured as an exception. */
	error: error_or_critical("error"),
	/** `log.critical(msg, err?, attrs?)` — same shape as error, higher severity. */
	critical: error_or_critical("critical"),

	span(name: string): Span {
		const p = ensureInitialized();
		if (!p) return { end: () => {} } as Span;
		return startSpan({ pulse: p, name });
	},

	trace(name: string, attrs?: Record<string, unknown>): void {
		log.span(name).end(attrs);
	},

	async flush(): Promise<void> {
		await ensureInitialized()?.flush();
	},
};

/** Emit a domain event (e.g. `project_created`) — distinct from a log line. */
export const track = (name: string, properties?: Record<string, unknown>): void => {
	ensureInitialized()?.event(name, properties);
};

/** Lazy singleton pulse instance for advanced use cases (manual flush, custom shapes). */
export const getPulse = (): Pulse | null => ensureInitialized();

// Eager init in browser context — installs error handlers right away on import.
if (typeof window !== "undefined") {
	ensureInitialized();
}
