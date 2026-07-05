import { getBrowserClient } from "@devpad/core/ui/client";
import type { PipelineRun } from "@devpad/schema";
import { Button } from "@f0rbit/ui";
import { createSignal, Show } from "solid-js";

type StageGateProps = {
	run: PipelineRun;
	user_id: string;
};

type RunGate = {
	type?: string;
	verdict?: string | null;
};

export default function StageGate(props: StageGateProps) {
	const [loading, setLoading] = createSignal<"approve" | "deny" | null>(null);
	const [error, setError] = createSignal<string | null>(null);
	const [showReason, setShowReason] = createSignal(false);
	const [reason, setReason] = createSignal("");

	const gate_config = (() => {
		try {
			const raw: unknown = JSON.parse(props.run.resolved_gates as string);
			const gates = raw as Record<string, RunGate> | null;
			if (!props.run.current_stage || !gates) return null;

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
		return gate_config.gate.type || "unknown";
	})();

	const gate_verdict = (() => {
		if (!gate_config) return null;
		return gate_config.gate.verdict || null;
	})();

	const show_actions = () =>
		props.run.status === "awaiting_approval" && gate_type() === "manual" && !gate_verdict() && !!gate_config;

	const target_stage_name = () => {
		if (!gate_config) return null;
		const parts = gate_config.key.split("→");
		return parts[1] ?? null;
	};

	const submit_decision = async (decision: "approved" | "denied") => {
		const stage_name = target_stage_name();
		if (!stage_name) {
			setError("Unable to determine target stage from gate key.");
			return;
		}

		setLoading(decision === "approved" ? "approve" : "deny");
		setError(null);

		const client = getBrowserClient();
		const trimmed_reason = reason().trim();
		const result = await client.pipelines.approve(props.run.id, {
			stage_name,
			decision,
			user_id: props.user_id,
			...(trimmed_reason ? { reason: trimmed_reason } : {}),
		});

		if (!result.ok) {
			setError(result.error.message);
			setLoading(null);
			return;
		}

		window.location.reload();
	};

	return (
		<div class="stack stack-md">
			<div class="card card-flat stack stack-md">
				<Show
					when={gate_config}
					fallback={<div class="text-sm text-muted">No gate configured for this stage transition.</div>}
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
								{gate_type()}
							</span>
						</div>

						<Show when={gate_verdict()}>
							<div class="row row-between">
								<span class="text-sm text-faint">Verdict</span>
								<span
									style={{
										padding: "0.25rem 0.75rem",
										"border-radius": "0.25rem",
										"background-color":
											gate_verdict() === "approved"
												? "var(--success-bg)"
												: gate_verdict() === "denied"
													? "var(--error-bg)"
													: "var(--info-bg)",
										"font-size": "0.85rem",
										"font-weight": "500",
										color:
											gate_verdict() === "approved"
												? "var(--success)"
												: gate_verdict() === "denied"
													? "var(--error)"
													: "var(--info)",
									}}
								>
									{gate_verdict()}
								</span>
							</div>
						</Show>

						{gate_type() === "manual" && (
							<div class="text-xs text-muted" style={{ "margin-top": "var(--space-xs)" }}>
								This stage requires manual approval before proceeding.
							</div>
						)}

						{gate_type() === "auto" && (
							<div class="text-xs text-muted" style={{ "margin-top": "var(--space-xs)" }}>
								This stage will automatically progress after bake period completes.
							</div>
						)}

						{gate_type() === "analysis" && (
							<div class="text-xs text-muted" style={{ "margin-top": "var(--space-xs)" }}>
								This stage uses automated analysis to determine the verdict.
							</div>
						)}
					</div>
				</Show>
			</div>

			<Show when={show_actions()}>
				<div class="card card-flat stack stack-sm" data-testid="stage-gate-actions">
					<div class="row" style={{ gap: "var(--space-sm)", "flex-wrap": "wrap", "align-items": "center" }}>
						<Button
							size="sm"
							variant="primary"
							disabled={loading() !== null}
							onClick={() => {
								void submit_decision("approved");
							}}
							data-testid="stage-gate-approve"
						>
							{loading() === "approve" ? "Approving..." : "Approve"}
						</Button>
						<Button
							size="sm"
							variant="danger"
							disabled={loading() !== null}
							onClick={() => {
								void submit_decision("denied");
							}}
							data-testid="stage-gate-deny"
						>
							{loading() === "deny" ? "Denying..." : "Deny"}
						</Button>
						<Show
							when={showReason()}
							fallback={
								<button
									type="button"
									onClick={() => setShowReason(true)}
									style={{
										"font-size": "0.85rem",
										color: "var(--text-link)",
										"text-decoration": "none",
										background: "none",
										border: "none",
										padding: 0,
										cursor: "pointer",
									}}
								>
									Add reason
								</button>
							}
						>
							<span class="text-sm text-faint">Reason (optional)</span>
						</Show>
						<Show when={error()}>
							<span class="text-sm" style={{ color: "var(--error)" }} data-testid="stage-gate-error">
								{error()}
							</span>
						</Show>
					</div>
					<Show when={showReason()}>
						<textarea
							value={reason()}
							onInput={(e) => setReason(e.currentTarget.value)}
							placeholder="Why are you approving or denying this stage?"
							rows={3}
							disabled={loading() !== null}
							data-testid="stage-gate-reason"
							style={{
								width: "100%",
								padding: "var(--space-sm)",
								"border-radius": "var(--radius)",
								border: "1px solid var(--border)",
								"background-color": "var(--bg)",
								color: "var(--fg)",
								"font-size": "0.9rem",
								"font-family": "inherit",
								resize: "vertical",
							}}
						/>
					</Show>
				</div>
			</Show>
		</div>
	);
}
