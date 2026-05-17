/**
 * Pulse analytics + observability for the devpad frontend.
 *
 * Singleton wrapper around @f0rbit/pulse-client. Reads config from
 * `import.meta.env.PUBLIC_*` (build-time inlined) and exposes a clean
 * function surface — no globals on `window`.
 *
 * Usage:
 *   import { track, captureError, pulseLog } from "@/lib/pulse";
 *   track("button_clicked", { id: "save" });
 *   captureError(err, { route: "/tasks" });
 *   pulseLog("warn", "rate limit hit", { ip });
 */

import { createPulse, type Pulse } from "@f0rbit/pulse-client";

type PulseLevel = "debug" | "info" | "warn" | "error" | "critical";

let _pulse: Pulse | null = null;
let _initialized = false;

const ensureInitialized = (): Pulse | null => {
	if (_initialized) return _pulse;
	_initialized = true;

	if (typeof window === "undefined") return null;

	const endpoint = import.meta.env.PUBLIC_PULSE_INGEST_URL as string | undefined;
	const project_id = import.meta.env.PUBLIC_DEVPAD_PROJECT_ID as string | undefined;
	const ingest_key = import.meta.env.PUBLIC_DEVPAD_PULSE_INGEST_KEY as string | undefined;
	const release = import.meta.env.PUBLIC_GIT_SHA as string | undefined;

	if (!endpoint || !project_id || !ingest_key) return null;

	_pulse = createPulse({
		project_id,
		ingest_key,
		endpoint,
		auto_pageview: true,
		release,
	});
	return _pulse;
};

/** Lazy-initialized singleton pulse instance. Null when env vars are unset (no-op). */
export const getPulse = (): Pulse | null => ensureInitialized();

/** Emit a custom event. Silently no-ops when pulse isn't configured. */
export const track = (name: string, properties?: Record<string, unknown>): void => {
	ensureInitialized()?.event(name, properties);
};

/** Capture an error with optional context. */
export const captureError = (err: unknown, ctx?: Record<string, unknown>): void => {
	ensureInitialized()?.captureError(err, ctx);
};

/** Structured log line. */
export const pulseLog = (level: PulseLevel, message: string, attrs?: Record<string, unknown>): void => {
	ensureInitialized()?.log(level, message, attrs);
};

/** Manually trigger a flush (e.g. before navigation/unload). */
export const flushPulse = async (): Promise<void> => {
	await ensureInitialized()?.flush();
};

/**
 * Wire global window error + unhandled-rejection handlers to captureError.
 * Call once after init (Layout.astro does this).
 */
export const installBrowserHandlers = (): void => {
	const p = ensureInitialized();
	if (!p || typeof window === "undefined") return;

	window.addEventListener("error", (e: ErrorEvent) => {
		const err = e.error ?? new Error(e.message);
		p.captureError(err, {
			source: "window.onerror",
			filename: e.filename,
			lineno: e.lineno,
			colno: e.colno,
		});
	});

	window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
		p.captureError(e.reason ?? new Error("unhandledrejection"), { source: "unhandledrejection" });
	});
};
