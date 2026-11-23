/**
 * @module solid/pipelines/IslandBoundary
 *
 * Wraps each run-detail Solid island in a Solid ErrorBoundary so a throwing
 * island renders a visible inline error instead of truncating the whole
 * streamed Astro page (production incident: StageGate threw during SSR and
 * Astro cut the HTML stream with no status-code signal — found only via
 * Cloudflare Workers Logs).
 *
 * Errors are reported to pulse in the browser (`@/lib/pulse` `log.error`,
 * no-ops when pulse is unconfigured). During SSR there is no browser pulse,
 * so they fall back to `console.error` — the channel CF Workers Logs
 * captures. A failing island must never take the page down again.
 *
 * Usage: each pipeline island component file wraps its own content root in
 * `<IslandBoundary>` (children stay Solid-compiled inside the island, so the
 * boundary is live in both the SSR pass and the hydrated tree).
 */
import { ErrorBoundary, type JSX } from "solid-js";
import { log } from "@/lib/pulse";

export type IslandErrorContext = {
	component: string;
	run_id?: string;
	package_id?: string;
	/** Defaults to `window.location.pathname` in the browser; irrelevant on the server. */
	route?: string;
};

export const report_island_error = (context: IslandErrorContext, error: unknown): void => {
	const message = error instanceof Error ? error.message : String(error);
	const route = context.route ?? (typeof window !== "undefined" ? window.location.pathname : undefined);
	const attrs = { component: context.component, run_id: context.run_id, package_id: context.package_id, route };
	if (typeof window === "undefined") {
		console.error(`[island] ${context.component} failed to render: ${message}`, attrs);
		return;
	}
	log.error("island render failed", error, attrs);
};

type IslandBoundaryProps = IslandErrorContext & {
	children: JSX.Element;
};

export default function IslandBoundary(props: IslandBoundaryProps) {
	return (
		<ErrorBoundary
			fallback={(error, reset) => {
				report_island_error(props, error);
				return (
					<div
						data-testid="island-error"
						role="alert"
						class="stack stack-xs"
						style={{
							padding: "0.6rem 0.9rem",
							border: "1px solid var(--error, var(--item-red))",
							background: "var(--error-bg, var(--bg-alt))",
							"border-radius": "var(--radius, 4px)",
						}}
					>
						<span class="text-sm">
							This section failed to render — {error instanceof Error ? error.message : String(error)}
						</span>
						<button
							type="button"
							onClick={() => {
								reset();
							}}
							class="text-sm"
							style={{
								color: "var(--text-link)",
								background: "none",
								border: "none",
								padding: 0,
								cursor: "pointer",
								"text-align": "left",
							}}
						>
							Retry
						</button>
					</div>
				);
			}}
		>
			{props.children}
		</ErrorBoundary>
	);
}
