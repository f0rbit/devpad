import type { PipelineRun } from "@devpad/schema";
import { Show } from "solid-js";

interface StageGateProps {
	run: PipelineRun;
}

export default function StageGate(props: StageGateProps) {
	const gate_config = (() => {
		try {
			const gates = JSON.parse(props.run.resolved_gates as any);
			if (!props.run.current_stage || !gates) return null;

			// Find gate for current stage transitions
			for (const [key, gate] of Object.entries(gates)) {
				if (key.includes(props.run.current_stage)) {
					return { key, gate };
				}
			}
			return null;
		} catch {
			return null;
		}
	})();

	const gate_type = (() => {
		if (!gate_config) return null;
		const gate: any = gate_config.gate;
		return gate?.type || "unknown";
	})();

	const gate_verdict = (() => {
		if (!gate_config) return null;
		const gate: any = gate_config.gate;
		return gate?.verdict || null;
	})();

	return (
		<div class="card card-flat stack stack-md">
			<Show
				when={gate_config}
				fallback={
					<div class="text-sm text-muted">No gate configured for this stage transition.</div>
				}
			>
				<div class="stack stack-sm">
					<div class="row row-between">
						<span class="text-sm text-faint">Gate Type</span>
						<span
							style={{
								padding: "0.25rem 0.75rem",
								"border-radius": "0.25rem",
								"background-color": "var(--bg-alt)",
								"font-size": "0.85rem",
								"font-weight": "500",
								color: "var(--fg)",
							}}
						>
							{gate_type}
						</span>
					</div>

					<Show when={gate_verdict}>
						<div class="row row-between">
							<span class="text-sm text-faint">Verdict</span>
							<span
								style={{
									padding: "0.25rem 0.75rem",
									"border-radius": "0.25rem",
									"background-color": gate_verdict === "approved" ? "var(--success-bg)" : gate_verdict === "denied" ? "var(--error-bg)" : "var(--info-bg)",
									"font-size": "0.85rem",
									"font-weight": "500",
									color: gate_verdict === "approved" ? "var(--success)" : gate_verdict === "denied" ? "var(--error)" : "var(--info)",
								}}
							>
								{gate_verdict}
							</span>
						</div>
					</Show>

					{gate_type === "manual" && (
						<div class="text-xs text-muted" style={{ "margin-top": "var(--space-xs)" }}>
							This stage requires manual approval before proceeding.
						</div>
					)}

					{gate_type === "auto" && (
						<div class="text-xs text-muted" style={{ "margin-top": "var(--space-xs)" }}>
							This stage will automatically progress after bake period completes.
						</div>
					)}

					{gate_type === "analysis" && (
						<div class="text-xs text-muted" style={{ "margin-top": "var(--space-xs)" }}>
							This stage uses automated analysis to determine the verdict.
						</div>
					)}
				</div>
			</Show>
		</div>
	);
}
