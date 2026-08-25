import { getBrowserClient } from "@devpad/core/ui/client";
import type { SdlcStage, Task } from "@devpad/schema";
import { SDLC_STAGES } from "@devpad/schema/database";
import { Button, Modal, ModalBody, ModalFooter, ModalHeader, ModalTitle, Step, Stepper } from "@f0rbit/ui";
import { createSignal, For, Show } from "solid-js";

export type SdlcStepperProps = {
	task: Task;
	onAdvanced: (updated: Task) => void;
};

const STAGE_LABEL: Record<SdlcStage, string> = {
	ideate: "Ideate",
	plan: "Plan",
	build: "Build",
	review: "Review",
	deploy: "Deploy",
	live: "Live",
};

/**
 * Task B3.3 — the SDLC stepper on a stage-tracked node's zoom header.
 * Gently enforced (locked decision 5, task A4.5): clicking the immediate
 * next stage attempts a plain advance; a 409 names the missing
 * checkpoint(s) and offers an audited manual override (a reason is
 * required — `docs.advance` records it on the `action` row). Only the
 * IMMEDIATE next stage is ever offered — `advance_stage_request.to` accepts
 * any stage, but `missing_checkpoints` only defines gates for specific
 * from→to pairs, so a multi-hop jump would silently skip a gate that a
 * single-hop advance would have hit. The UI simply never offers that jump.
 */
export default function SdlcStepper(props: SdlcStepperProps) {
	const [error, setError] = createSignal<string | null>(null);
	const [overrideOpen, setOverrideOpen] = createSignal(false);
	const [overrideReason, setOverrideReason] = createSignal("");
	const [submitting, setSubmitting] = createSignal(false);

	const currentIndex = () => (props.task.stage ? SDLC_STAGES.indexOf(props.task.stage) : -1);
	const nextStage = (): SdlcStage | null => {
		const idx = currentIndex();
		return idx >= 0 && idx < SDLC_STAGES.length - 1 ? SDLC_STAGES[idx + 1] : null;
	};

	async function attemptAdvance(override: boolean, reason?: string): Promise<void> {
		const to = nextStage();
		if (!to) return;
		setSubmitting(true);
		setError(null);
		const result = await getBrowserClient().tasks.advanceStage(props.task.id, { to, override, reason });
		setSubmitting(false);
		if (!result.ok) {
			setError(result.error.message);
			return;
		}
		setOverrideOpen(false);
		setOverrideReason("");
		props.onAdvanced(result.value);
	}

	return (
		<div class="sdlc-stepper" data-testid="sdlc-stepper">
			<Stepper orientation="horizontal">
				<For each={SDLC_STAGES}>
					{(stage, i) => (
						<Step
							title={STAGE_LABEL[stage]}
							status={i() < currentIndex() ? "completed" : i() === currentIndex() ? "current" : "upcoming"}
							data-testid="sdlc-step"
							data-stage={stage}
							onClick={() => {
								if (stage === nextStage()) void attemptAdvance(false);
							}}
						/>
					)}
				</For>
			</Stepper>
			<Show when={error()}>
				<div class="sdlc-stepper-error" data-testid="sdlc-stepper-error">
					<p>{error()}</p>
					<button
						type="button"
						class="thread-action-link"
						data-testid="sdlc-override-open"
						onClick={() => {
							setOverrideOpen(true);
						}}
					>
						Override (audited)
					</button>
				</div>
			</Show>

			<Modal open={overrideOpen()} onClose={() => setOverrideOpen(false)}>
				<ModalHeader>
					<ModalTitle>Override stage gate</ModalTitle>
				</ModalHeader>
				<ModalBody>
					<p class="text-sm text-faint">
						This bypasses the missing checkpoint(s) above. The override is recorded on the task's history with your
						reason.
					</p>
					<textarea
						data-testid="sdlc-override-reason"
						placeholder="Reason for overriding (required)"
						value={overrideReason()}
						onInput={(e) => {
							setOverrideReason(e.currentTarget.value);
						}}
					/>
				</ModalBody>
				<ModalFooter>
					<Button variant="secondary" onClick={() => setOverrideOpen(false)}>
						Cancel
					</Button>
					<Button
						data-testid="sdlc-override-submit"
						disabled={submitting() || overrideReason().trim().length === 0}
						onClick={() => {
							void attemptAdvance(true, overrideReason().trim());
						}}
					>
						Override & advance
					</Button>
				</ModalFooter>
			</Modal>
		</div>
	);
}
