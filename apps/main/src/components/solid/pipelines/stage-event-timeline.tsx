/**
 * @module solid/pipelines/StageEventTimeline
 *
 * Phase 2.C — vertical stage-event timeline for the run-detail page.
 *
 * Fetches via `client.pipelines.events.list(run_id)` on mount. Renders
 * each event as a row with:
 *
 * - colour-coded Badge for the kind (error/warning highlighted;
 *   gate_verdict + deploy_completed accent; informational kinds neutral)
 * - stage name
 * - relative timestamp ("3m ago") with absolute ISO in the `title` attr
 * - expandable payload pretty-print (collapsed by default; long payloads
 *   don't blow out the layout)
 *
 * Empty state uses the `<Empty>` primitive.
 */

import { getBrowserClient } from "@devpad/core/ui/client";
import type { PipelineStageEvent, StageEventKind } from "@devpad/schema";
import { Badge, Empty } from "@f0rbit/ui";
import { createSignal, For, onMount, Show } from "solid-js";

type StageEventTimelineProps = {
	run_id: string;
};

type BadgeVariant = "success" | "error" | "warning" | "info" | "accent" | "default";

const kind_variant = (kind: StageEventKind): BadgeVariant => {
	if (kind === "error") return "error";
	if (kind === "warning") return "warning";
	if (kind === "deploy_completed" || kind === "rollback_completed") return "success";
	if (kind === "gate_verdict") return "info";
	if (kind === "approval_requested") return "accent";
	// deploy_started, bake_started, bake_completed, rollback_started
	return "default";
};

/**
 * Format an ISO timestamp as a relative string. Bucket boundaries are
 * deliberately coarse — seconds for very recent, then minutes, hours,
 * days. Anything older than ~30 days falls back to the absolute date.
 */
const format_relative = (iso: string): string => {
	const then = new Date(iso).getTime();
	if (Number.isNaN(then)) return iso;
	const now = Date.now();
	const diff_ms = Math.max(0, now - then);
	const seconds = Math.floor(diff_ms / 1000);
	if (seconds < 5) return "just now";
	if (seconds < 60) return `${String(seconds)}s ago`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${String(minutes)}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${String(hours)}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 30) return `${String(days)}d ago`;
	return new Date(iso).toLocaleDateString();
};

const stringify_payload = (payload: unknown): string => {
	if (payload === null || payload === undefined) return "null";
	try {
		return JSON.stringify(payload, null, 2);
	} catch {
		return "[unserializable payload]";
	}
};

export default function StageEventTimeline(props: StageEventTimelineProps) {
	const [events, setEvents] = createSignal<PipelineStageEvent[]>([]);
	const [loading, setLoading] = createSignal<boolean>(true);
	const [error, setError] = createSignal<string | null>(null);
	const [expanded, setExpanded] = createSignal<Set<string>>(new Set());

	const toggle = (id: string) => {
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const load = async () => {
		const client = getBrowserClient();
		const result = await client.pipelines.events.list(props.run_id);
		if (!result.ok) {
			setError(result.error.message);
			setLoading(false);
			return;
		}
		setEvents(result.value);
		setLoading(false);
	};

	onMount(() => {
		void load();
	});

	return (
		<div class="stack stack-sm">
			<Show when={error()}>
				<p class="text-sm" style={{ color: "var(--item-red)", margin: "0" }}>
					{error()}
				</p>
			</Show>

			<Show when={!loading() && events().length === 0 && error() === null}>
				<Empty title="No events yet" description="Webhook events from CI / external systems will appear here." />
			</Show>

			<Show when={loading()}>
				<p class="text-sm text-faint" style={{ margin: "0" }}>
					Loading events…
				</p>
			</Show>

			<For each={events()}>
				{(ev) => (
					<div
						style={{
							display: "flex",
							"flex-direction": "column",
							gap: "0.5rem",
							padding: "0.75rem",
							"border-radius": "var(--radius)",
							border: "1px solid var(--border)",
							"background-color": "transparent",
						}}
					>
						<div
							style={{
								display: "flex",
								"align-items": "center",
								"justify-content": "space-between",
								gap: "0.5rem",
								"flex-wrap": "wrap",
							}}
						>
							<div style={{ display: "flex", "align-items": "center", gap: "0.5rem", "flex-wrap": "wrap" }}>
								<Badge variant={kind_variant(ev.kind)}>{ev.kind}</Badge>
								<span style={{ "font-size": "0.85rem", opacity: 0.85 }}>{ev.stage_name}</span>
							</div>
							<span
								title={ev.ts}
								style={{ "font-size": "0.8rem", opacity: 0.6, "font-variant-numeric": "tabular-nums" }}
							>
								{format_relative(ev.ts)}
							</span>
						</div>

						<Show when={ev.payload !== null && ev.payload !== undefined}>
							<div class="stack stack-xs">
								<button
									type="button"
									onClick={() => {
										toggle(ev.id);
									}}
									style={{
										"align-self": "flex-start",
										background: "none",
										border: "none",
										color: "var(--text-link)",
										cursor: "pointer",
										padding: "0",
										"font-size": "0.8rem",
									}}
								>
									{expanded().has(ev.id) ? "▾ payload" : "▸ payload"}
								</button>
								<Show when={expanded().has(ev.id)}>
									<pre
										style={{
											margin: "0",
											padding: "0.5rem",
											"background-color": "var(--bg-alt)",
											"border-radius": "var(--radius)",
											"font-size": "0.75rem",
											"font-family": "monospace",
											"max-height": "240px",
											"overflow-y": "auto",
											"overflow-x": "auto",
											"white-space": "pre-wrap",
											"word-break": "break-word",
										}}
									>
										{stringify_payload(ev.payload)}
									</pre>
								</Show>
							</div>
						</Show>
					</div>
				)}
			</For>
		</div>
	);
}
