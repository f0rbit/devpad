import type { PipelineRun } from "@devpad/schema";
import { For, Show } from "solid-js";
import IslandBoundary, { report_island_error } from "@/components/solid/pipelines/island-boundary";
import { ROLLOUT_READ_ERROR, read_rollout, stages_for_run } from "@/utils/pipeline-plan";

type RunProgressProps = {
	run: PipelineRun;
};

const RunProgressContent = (props: RunProgressProps) => {
	// `resolved_rollout` is an already-parsed object on the wire (drizzle
	// `mode: "json"`). Never JSON.parse it — the silent catch that swallowed
	// that throw is why the stage circles rendered empty.
	const rollout_read = read_rollout(props.run.resolved_rollout);
	if (!rollout_read.ok) {
		report_island_error(
			{ component: "RunProgress", run_id: props.run.id, package_id: props.run.package_id },
			new Error(`resolved_rollout read failed: ${rollout_read.reason}`),
		);
	}

	const progress = () => (rollout_read.ok ? stages_for_run(props.run, rollout_read.value) : null);
	const stages = () => progress()?.stages ?? [];
	const current_stage_idx = () => progress()?.current_index ?? -1;

	return (
		<div class="stack stack-md">
			<Show when={!rollout_read.ok}>
				<div
					data-testid="run-progress-read-error"
					role="alert"
					class="text-sm"
					style={{ color: "var(--error, var(--item-red))" }}
				>
					{ROLLOUT_READ_ERROR}
				</div>
			</Show>
			<div class="row" style="gap: var(--space-xs); overflow-x: auto; padding-bottom: var(--space-xs);">
				<For each={stages()}>
					{(stage, idx) => (
						<div
							style={{
								display: "flex",
								"flex-direction": "column",
								"align-items": "center",
								gap: "var(--space-xs)",
								"flex-shrink": 0,
							}}
						>
							<div
								style={{
									width: "44px",
									height: "44px",
									"border-radius": "50%",
									border: `2px solid ${
										idx() < current_stage_idx()
											? "var(--success)"
											: idx() === current_stage_idx()
												? "var(--info)"
												: "var(--border)"
									}`,
									background:
										idx() < current_stage_idx()
											? "var(--success-bg)"
											: idx() === current_stage_idx()
												? "var(--info-bg)"
												: "var(--bg-alt)",
									display: "flex",
									"align-items": "center",
									"justify-content": "center",
									"font-size": "0.85rem",
									"font-weight": "600",
									color:
										idx() < current_stage_idx()
											? "var(--success)"
											: idx() === current_stage_idx()
												? "var(--info)"
												: "var(--fg-muted)",
								}}
							>
								{idx() < current_stage_idx() ? (
									<svg
										xmlns="http://www.w3.org/2000/svg"
										width="20"
										height="20"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
									>
										<polyline points="20 6 9 17 4 12" />
									</svg>
								) : (
									String(idx() + 1)
								)}
							</div>
							<div
								style={{
									"text-align": "center",
									"font-size": "0.75rem",
									color: "var(--fg-muted)",
									"max-width": "60px",
									"word-break": "break-word",
								}}
							>
								{stage}
							</div>
						</div>
					)}
				</For>
			</div>

			<Show when={stages().length > 0}>
				<div class="card card-flat">
					<div class="stack stack-xs">
						<div class="text-sm text-faint">Current Stage</div>
						<div style={{ "font-size": "1.1rem", "font-weight": "500" }}>{props.run.current_stage || "—"}</div>
					</div>
				</div>
			</Show>
		</div>
	);
};

export default function RunProgress(props: RunProgressProps) {
	return (
		<IslandBoundary component="RunProgress" run_id={props.run.id} package_id={props.run.package_id}>
			<RunProgressContent {...props} />
		</IslandBoundary>
	);
}
