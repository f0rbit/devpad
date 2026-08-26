import { getBrowserClient } from "@devpad/core/ui/client";
import type { SdlcStage, Task } from "@devpad/schema";
import { SDLC_STAGES } from "@devpad/schema/database";
import { Button, Modal, ModalBody, ModalFooter, ModalHeader, ModalTitle, Step, Stepper } from "@f0rbit/ui";
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";

function LockIcon() {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="12"
			height="12"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			data-testid="sdlc-step-lock-icon"
		>
			<rect x="3" y="11" width="18" height="11" rx="2" />
			<path d="M7 11V7a5 5 0 0 1 10 0v4" />
		</svg>
	);
}

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
	const [nextStageLocked, setNextStageLocked] = createSignal(false);
	// B3 fast-follow #10 — @f0rbit/ui's `Modal` doesn't restore focus itself
	// (it fully unmounts children on close via an internal `<Show>`, which is
	// exactly what makes an `onCleanup` here reliable). Captures the trigger
	// right before opening; the LensShell pattern (`onMount(() => ref.focus())`)
	// covers autofocusing the reason textarea on open.
	let overrideTriggerRef: HTMLButtonElement | undefined;
	let overrideReasonRef: HTMLTextAreaElement | undefined;
	createEffect(() => {
		if (!overrideOpen()) return;
		overrideReasonRef?.focus();
		onCleanup(() => overrideTriggerRef?.focus());
	});

	const currentIndex = () => (props.task.stage ? SDLC_STAGES.indexOf(props.task.stage) : -1);
	const nextStage = (): SdlcStage | null => {
		const idx = currentIndex();
		return idx >= 0 && idx < SDLC_STAGES.length - 1 ? SDLC_STAGES[idx + 1] : null;
	};

	/**
	 * B3 fast-follow #12 — a lock glyph on the immediate next step whenever a
	 * checkpoint gating THIS hop (see `stage.ts`'s `missing_checkpoints`:
	 * plan→build needs "plan", review→deploy needs "types" + "design" when a
	 * design doc exists) is currently pending decision. Mirrors
	 * `checkpoints.tsx`'s own pending lookups — a display-only signal, never
	 * itself gating the click (the server's `advance` call remains the
	 * authority; a stale/missing lock here just means a plain advance attempt
	 * surfaces the same 409 it always did).
	 */
	async function refreshLockState(): Promise<void> {
		const from = props.task.stage;
		const to = nextStage();
		if (from === "plan" && to === "build") {
			const result = await getBrowserClient().signoffs.findPending({
				subject_kind: "stage",
				subject_id: props.task.id,
				checkpoint: "plan",
			});
			setNextStageLocked(result.ok && result.value !== null);
			return;
		}
		if (from === "review" && to === "deploy") {
			const client = getBrowserClient();
			const types_pending = client.signoffs.findPending({
				subject_kind: "stage",
				subject_id: props.task.id,
				checkpoint: "types",
			});
			const docs_result = await client.docs.list({ project_id: props.task.project_id ?? "", task_id: props.task.id });
			const design_doc = docs_result.ok ? docs_result.value.find((d) => d.kind === "design") : undefined;
			const design_pending = design_doc
				? client.signoffs.findPending({ subject_kind: "doc_version", subject_id: design_doc.id, checkpoint: "design" })
				: null;
			const [types_result, design_result] = await Promise.all([types_pending, design_pending]);
			const types_locked = types_result.ok && types_result.value !== null;
			const design_locked = design_result !== null && design_result.ok && design_result.value !== null;
			setNextStageLocked(types_locked || design_locked);
		}
	}
	onMount(() => void refreshLockState());

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
							icon={stage === nextStage() && nextStageLocked() ? <LockIcon /> : undefined}
							data-testid="sdlc-step"
							data-stage={stage}
							data-locked={stage === nextStage() && nextStageLocked() ? "true" : undefined}
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
						ref={overrideTriggerRef}
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
						ref={overrideReasonRef}
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
