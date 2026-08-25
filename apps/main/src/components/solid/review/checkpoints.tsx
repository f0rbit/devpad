import { getBrowserClient } from "@devpad/core/ui/client";
import type { PulseSummary } from "@devpad/api";
import type { Document, Signoff, Task } from "@devpad/schema";
import { Badge, Button } from "@f0rbit/ui";
import { createSignal, onMount, Show } from "solid-js";
import { diffLines } from "@/utils/text-diff";

export type CheckpointsProps = { task: Task };

type Classification = "additive" | "breaking" | "unchanged" | "single-version";

/**
 * Task B3.3 — checkpoint cards paired with the SDLC stepper. Two different
 * signoff shapes are genuinely in play here (see `stage.ts`'s
 * `missing_checkpoints`): the plan/types checkpoints that gate a stage
 * transition are `subject_kind:"stage"` and decided right here; the design
 * checkpoint that gates review→deploy is `subject_kind:"doc_version"` on
 * the design doc itself, decided through DocViewer's own verdict bar — this
 * card is a link/preview for that one, not a second decide UI.
 */
export default function Checkpoints(props: CheckpointsProps) {
	return (
		<div class="checkpoints" data-testid="checkpoints">
			<Show when={props.task.stage === "plan"}>
				<PlanCheckpointCard task={props.task} />
			</Show>
			<Show when={props.task.stage === "review"}>
				<TypesCheckpointCard task={props.task} />
				<DesignCheckpointCard task={props.task} />
			</Show>
		</div>
	);
}

/** The most recently updated doc of `kind` for this task — a task can accumulate more than one (e.g. `push_interface_report` called repeatedly without `document_id`), and it's always the LATEST one a checkpoint card should show. */
function latest_doc_of_kind(docs: Document[], kind: Document["kind"]): Document | undefined {
	return docs.filter((d) => d.kind === kind).toSorted((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
}

function useDocForTask(task: Task, kind: Document["kind"]): () => Document | undefined {
	const [doc, setDoc] = createSignal<Document | undefined>(undefined);
	onMount(async () => {
		const result = await getBrowserClient().docs.list({ project_id: task.project_id ?? "", task_id: task.id });
		if (result.ok) setDoc(latest_doc_of_kind(result.value, kind));
	});
	return doc;
}

/** The plan/types stage-subject checkpoint's decide affordance — shared behavior, rendered inline by each card (never a nested card-in-card). */
function useStageDecision(task: Task, checkpoint: "plan" | "types") {
	const client = getBrowserClient();
	const [pending, setPending] = createSignal<Signoff | null>(null);
	const [reason, setReason] = createSignal("");
	const [submitting, setSubmitting] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);

	onMount(async () => {
		const result = await client.signoffs.findPending({ subject_kind: "stage", subject_id: task.id, checkpoint });
		if (result.ok) setPending(result.value);
	});

	async function decide(decision: "approved" | "changes_requested"): Promise<void> {
		const signoff = pending();
		if (!signoff) return;
		setSubmitting(true);
		setError(null);
		const result = await client.signoffs.decide(signoff.id, { decision, reason: reason().trim() || undefined });
		setSubmitting(false);
		if (!result.ok) {
			setError(result.error.message);
			return;
		}
		setPending(null);
	}

	return { pending, reason, setReason, submitting, error, decide };
}

function PlanCheckpointCard(props: { task: Task }) {
	const doc = useDocForTask(props.task, "plan");
	const { pending, reason, setReason, submitting, error, decide } = useStageDecision(props.task, "plan");

	return (
		<div class="checkpoint-card" data-testid="checkpoint-card-plan">
			<h5>plan checkpoint</h5>
			<Show when={doc()}>
				{(d) => (
					<a class="checkpoint-doc-link" href={`/project/${props.task.project_id}/docs?doc=${d().id}`}>
						View plan doc →
					</a>
				)}
			</Show>
			<Show when={error()}>
				<p class="text-xs" style={{ color: "var(--error-fg)" }} data-testid="checkpoint-error-plan">
					{error()}
				</p>
			</Show>
			<Show when={pending()} fallback={<p class="text-xs text-faint">No pending plan checkpoint request.</p>}>
				<textarea
					placeholder="Reason (optional)"
					value={reason()}
					onInput={(e) => {
						setReason(e.currentTarget.value);
					}}
				/>
				<div class="checkpoint-actions">
					<Button
						data-testid="checkpoint-approve-plan"
						disabled={submitting()}
						onClick={() => {
							void decide("approved");
						}}
					>
						Approve
					</Button>
					<Button
						variant="secondary"
						disabled={submitting()}
						onClick={() => {
							void decide("changes_requested");
						}}
					>
						Request changes
					</Button>
				</div>
			</Show>
		</div>
	);
}

function TypesCheckpointCard(props: { task: Task }) {
	const client = getBrowserClient();
	const doc = useDocForTask(props.task, "interface");
	const { pending, reason, setReason, submitting, error, decide } = useStageDecision(props.task, "types");
	const [classification, setClassification] = createSignal<Classification | null>(null);
	const [pulse, setPulse] = createSignal<PulseSummary | null>(null);
	const [pulseError, setPulseError] = createSignal(false);
	const [metricName, setMetricName] = createSignal<string | null>(null);

	onMount(async () => {
		const near_result = await client.tasks.near(props.task.id, 1);
		if (near_result.ok) {
			const edge = near_result.value.links.find((l) => l.kind === "tracks_metric" && l.src_id === props.task.id);
			const ref = edge?.ref as { metric_name?: string } | null;
			if (ref?.metric_name) setMetricName(ref.metric_name);
		}

		if (props.task.project_id) {
			const summary_result = await client.pulse.summary({ project_id: props.task.project_id, range: "24h" });
			if (summary_result.ok) setPulse(summary_result.value);
			else setPulseError(true);
		}
	});

	onMount(async () => {
		const result = await client.docs.list({ project_id: props.task.project_id ?? "", task_id: props.task.id });
		if (!result.ok) return;
		const interface_doc = latest_doc_of_kind(result.value, "interface");
		if (!interface_doc) return;
		const versions = await client.docs.versions(interface_doc.id);
		if (!versions.ok || versions.value.length === 0) return;
		if (versions.value.length < 2) {
			setClassification("single-version");
			return;
		}
		const [newer, older] = versions.value;
		const [newer_content, older_content] = await Promise.all([
			client.docs.pull(interface_doc.id, newer.version),
			client.docs.pull(interface_doc.id, older.version),
		]);
		if (!newer_content.ok || !older_content.ok || !newer_content.value.content || !older_content.value.content) return;
		const lines = diffLines(older_content.value.content.html, newer_content.value.content.html);
		if (lines.every((l) => l.kind === "same")) setClassification("unchanged");
		else if (lines.some((l) => l.kind === "remove")) setClassification("breaking");
		else setClassification("additive");
	});

	return (
		<div class="checkpoint-card" data-testid="checkpoint-card-types">
			<h5>types checkpoint</h5>
			<Show when={doc()}>
				{(d) => (
					<a class="checkpoint-doc-link" href={`/project/${props.task.project_id}/docs?doc=${d().id}`}>
						View interface report →
					</a>
				)}
			</Show>
			<Show when={classification()}>
				{(c) => (
					<span
						class={`outline-chip ${c() === "breaking" ? "outline-chip-blocked" : c() === "additive" ? "outline-chip-ready" : ""}`}
						data-testid="interface-classification-chip"
					>
						{c()}
					</span>
				)}
			</Show>
			<Show when={metricName()}>
				{(name) => (
					<div class="checkpoint-metric" data-testid="checkpoint-metric">
						<span class="text-xs text-faint">tracked metric: {name()}</span>
						<Show
							when={!pulseError()}
							fallback={<p class="text-xs text-faint">Pulse metrics unavailable right now.</p>}
						>
							<Show when={pulse()}>
								{(p) => (
									<div class="row row-sm">
										<Badge variant={p().errors > 0 ? "warning" : "success"}>{p().errors} errors (24h)</Badge>
										<Show when={p().p95_latency_ms !== null}>
											<Badge variant="default">p95 {p().p95_latency_ms}ms</Badge>
										</Show>
									</div>
								)}
							</Show>
						</Show>
					</div>
				)}
			</Show>
			<Show when={error()}>
				<p class="text-xs" style={{ color: "var(--error-fg)" }} data-testid="checkpoint-error-types">
					{error()}
				</p>
			</Show>
			<Show when={pending()} fallback={<p class="text-xs text-faint">No pending types checkpoint request.</p>}>
				<textarea
					placeholder="Reason (optional)"
					value={reason()}
					onInput={(e) => {
						setReason(e.currentTarget.value);
					}}
				/>
				<div class="checkpoint-actions">
					<Button
						data-testid="checkpoint-approve-types"
						disabled={submitting()}
						onClick={() => {
							void decide("approved");
						}}
					>
						Approve
					</Button>
					<Button
						variant="secondary"
						disabled={submitting()}
						onClick={() => {
							void decide("changes_requested");
						}}
					>
						Request changes
					</Button>
				</div>
			</Show>
		</div>
	);
}

function DesignCheckpointCard(props: { task: Task }) {
	const doc = useDocForTask(props.task, "design");
	return (
		<Show when={doc()}>
			{(d) => (
				<div class="checkpoint-card" data-testid="checkpoint-card-design">
					<h5>design checkpoint</h5>
					<a class="checkpoint-doc-link" href={`/project/${props.task.project_id}/docs?doc=${d().id}`}>
						View design doc →
					</a>
					<p class="text-xs text-faint">Decided from the design doc's own verdict bar.</p>
				</div>
			)}
		</Show>
	);
}
