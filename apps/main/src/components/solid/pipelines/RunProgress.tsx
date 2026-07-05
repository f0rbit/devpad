import type { PipelineRun } from "@devpad/schema";
import { For, Show } from "solid-js";

interface RunProgressProps {
	run: PipelineRun;
}

export default function RunProgress(props: RunProgressProps) {
	const stages = (() => {
		try {
			const rollout = JSON.parse(props.run.resolved_rollout as any);
			return rollout.stages || [];
		} catch {
			return [];
		}
	})();

	const current_stage_idx = stages.findIndex((s: any) => s.name === props.run.current_stage);

	return (
		<div class="stack stack-md">
			<div class="row" style="gap: var(--space-xs); overflow-x: auto; padding-bottom: var(--space-xs);">
				<For each={stages}>
					{(stage: any, idx) => (
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
										idx() < current_stage_idx
											? "var(--success)"
											: idx() === current_stage_idx
												? "var(--info)"
												: "var(--border)"
									}`,
									background:
										idx() < current_stage_idx
											? "var(--success-bg)"
											: idx() === current_stage_idx
												? "var(--info-bg)"
												: "var(--bg-alt)",
									display: "flex",
									"align-items": "center",
									"justify-content": "center",
									"font-size": "0.85rem",
									"font-weight": "600",
									color:
										idx() < current_stage_idx
											? "var(--success)"
											: idx() === current_stage_idx
												? "var(--info)"
												: "var(--fg-muted)",
								}}
							>
								{idx() < current_stage_idx ? (
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
								{stage.name}
							</div>
						</div>
					)}
				</For>
			</div>

			<Show when={stages.length > 0}>
				<div class="card card-flat">
					<div class="stack stack-xs">
						<div class="text-sm text-faint">Current Stage</div>
						<div style={{ "font-size": "1.1rem", "font-weight": "500" }}>{props.run.current_stage || "—"}</div>
					</div>
				</div>
			</Show>
		</div>
	);
}
