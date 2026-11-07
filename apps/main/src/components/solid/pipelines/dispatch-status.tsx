/**
 * @module solid/pipelines/DispatchStatusPanel
 *
 * External deploy mode (#155) — dispatch ledger for an external run plus the
 * human re-dispatch control.
 *
 * Fetches via `client.pipelines.dispatches(run_id)` on mount. One row per
 * stage: stage name, claim/dispatch status badge, commit SHA, and error text.
 * When any production dispatch row is `failed`, the Re-dispatch button is
 * offered (human action — the browser client is always the user channel, and
 * the worker proxy enforces `auth_channel === "user"` server-side anyway).
 * On success the page reloads to show the resulting state.
 *
 * Deps: unreachable orchestrator / non-dispatch runs render nothing —
 * the page-level degraded banner owns that failure surface.
 */

import type { PipelineDispatchEntry, PipelineDispatches } from "@devpad/api";
import { getBrowserClient } from "@devpad/core/ui/client";
import { Badge, Button, Empty } from "@f0rbit/ui";
import { createSignal, For, onMount, Show } from "solid-js";
import { short_sha } from "@/utils/pipeline-external";

type DispatchStatusPanelProps = {
	run_id: string;
};

type BadgeVariant = "success" | "error" | "warning" | "info" | "accent" | "default";

const status_variant = (status: PipelineDispatchEntry["status"]): BadgeVariant => {
	if (status === "dispatched") return "success";
	if (status === "failed") return "error";
	return "default";
};

export default function DispatchStatusPanel(props: DispatchStatusPanelProps) {
	const [result, setResult] = createSignal<PipelineDispatches | null>(null);
	const [loading, setLoading] = createSignal(true);
	const [redispatching, setRedispatching] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);

	const load = async () => {
		const client = getBrowserClient();
		const outcome = await client.pipelines.dispatches(props.run_id);
		setLoading(false);
		if (!outcome.ok) return;
		setResult(outcome.value);
	};

	onMount(() => {
		void load();
	});

	const has_failed_dispatch = () =>
		(result()?.dispatches ?? []).some((d) => d.stage_name === "production" && d.status === "failed");

	const redispatch = async () => {
		setRedispatching(true);
		setError(null);
		const client = getBrowserClient();
		const outcome = await client.pipelines.redispatch(props.run_id);
		if (!outcome.ok) {
			setRedispatching(false);
			setError(outcome.error.message);
			return;
		}
		window.location.reload();
	};

	return (
		<div class="stack stack-sm" data-testid="dispatch-status">
			<Show when={loading()}>
				<p class="text-sm text-faint" style={{ margin: "0" }}>
					Loading dispatches…
				</p>
			</Show>
			<Show when={error()}>
				<p class="text-sm" style={{ color: "var(--error)", margin: "0" }} data-testid="dispatch-error">
					{error()}
				</p>
			</Show>
			<For each={result()?.dispatches ?? []}>
				{(d) => (
					<div class="row row-sm" data-testid={`dispatch-row-${d.stage_name}`} style={{ "flex-wrap": "wrap" }}>
						<span class="font-mono text-sm" title={d.commit_sha ?? undefined}>
							{d.stage_name}
						</span>
						<Badge variant={status_variant(d.status)}>{d.status}</Badge>
						{d.commit_sha && <code class="text-xs text-faint">{short_sha(d.commit_sha)}</code>}
						<Show when={d.error}>
							<span class="text-sm" style={{ color: "var(--error)" }}>
								{d.error}
							</span>
						</Show>
					</div>
				)}
			</For>
			<Show when={!loading() && result() !== null && (result()?.dispatches ?? []).length === 0}>
				<Empty title="No dispatches" description="No CI dispatch has been requested for this run yet." />
			</Show>
			<Show when={has_failed_dispatch()}>
				<div class="row row-sm">
					<Button
						size="sm"
						variant="secondary"
						loading={redispatching()}
						disabled={redispatching()}
						data-testid="dispatch-redispatch"
						onClick={() => {
							void redispatch();
						}}
					>
						Re-dispatch
					</Button>
				</div>
			</Show>
		</div>
	);
}
