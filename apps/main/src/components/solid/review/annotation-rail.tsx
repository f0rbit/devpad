import { getBrowserClient } from "@devpad/core/ui/client";
import type { PullDocResponse } from "@devpad/api";
import type { Signoff, ThreadMarker } from "@devpad/schema";
import { Button } from "@f0rbit/ui";
import { createSignal, For, onMount, Show } from "solid-js";
import { anchorFromRange } from "@/utils/dom-text-range";

export type AnnotationRailProps = {
	documentId: string;
	pulled: PullDocResponse;
	checkpoint: "plan" | "types" | "design";
	getIframe: () => HTMLIFrameElement | undefined;
	/** Fired after any mutation (thread create/reply/resolve/blocking-toggle) — DocViewer re-pulls content + versions and passes the fresh result back down. */
	onChanged: (fresh: PullDocResponse) => void;
};

type PendingAnchor = ReturnType<typeof anchorFromRange>;

const STATUS_LABEL: Record<ThreadMarker["status"], string> = {
	open: "open",
	addressed: "addressed",
	resolved: "resolved",
	orphaned: "orphaned",
};

/**
 * Task B3.2 — the human surface for the A4 markers-in-doc engine. Select
 * text in the DocViewer's iframe → margin thread → Save embeds a marker and
 * mints a new corpus version (the core loop). Per-thread resolve is a
 * SEPARATE machine from the verdict bar's approve/request-changes — two
 * different questions ("is this specific note addressed" vs "is the whole
 * document good to proceed").
 *
 * Reads the selection out of the iframe via `contentWindow.getSelection()` —
 * viable because `sandbox="allow-same-origin"` (set on DocViewer's iframe)
 * keeps the document same-origin-readable even though its own scripts never
 * run.
 */
export default function AnnotationRail(props: AnnotationRailProps) {
	const client = getBrowserClient();
	const [pendingAnchor, setPendingAnchor] = createSignal<PendingAnchor>(null);
	const [composerBody, setComposerBody] = createSignal("");
	const [composerBlocking, setComposerBlocking] = createSignal(false);
	const [replyingTo, setReplyingTo] = createSignal<string | null>(null);
	const [replyBody, setReplyBody] = createSignal("");
	const [saving, setSaving] = createSignal(false);
	const [selectionHint, setSelectionHint] = createSignal<string | null>(null);
	const [pendingSignoff, setPendingSignoff] = createSignal<Signoff | null>(null);
	const [verdictReason, setVerdictReason] = createSignal("");

	async function loadPendingSignoff(): Promise<void> {
		const result = await client.signoffs.findPending({
			subject_kind: "doc_version",
			subject_id: props.documentId,
			checkpoint: props.checkpoint,
		});
		setPendingSignoff(result.ok ? result.value : null);
	}
	onMount(() => void loadPendingSignoff());

	function captureSelection(): void {
		const iframe = props.getIframe();
		const body = iframe?.contentDocument?.body;
		const selection = iframe?.contentWindow?.getSelection();
		if (!body || !selection || selection.rangeCount === 0) {
			setSelectionHint("Select some text in the document first.");
			return;
		}
		const anchor = anchorFromRange(body, selection.getRangeAt(0));
		if (!anchor) {
			setSelectionHint("Select some text in the document first.");
			return;
		}
		setSelectionHint(null);
		setPendingAnchor(anchor);
	}

	async function saveThread(): Promise<void> {
		const anchor = pendingAnchor();
		const body = composerBody().trim();
		if (!anchor || !body) return;
		setSaving(true);
		const result = await client.docs.createThread(props.documentId, { ...anchor, body, blocking: composerBlocking() });
		setSaving(false);
		if (!result.ok) return;
		setPendingAnchor(null);
		setComposerBody("");
		setComposerBlocking(false);
		const fresh = await client.docs.pull(props.documentId);
		if (fresh.ok) props.onChanged(fresh.value);
	}

	async function sendReply(thread_id: string): Promise<void> {
		const body = replyBody().trim();
		if (!body) return;
		setSaving(true);
		const result = await client.docs.replyThread(props.documentId, thread_id, body);
		setSaving(false);
		if (!result.ok) return;
		setReplyingTo(null);
		setReplyBody("");
		const fresh = await client.docs.pull(props.documentId);
		if (fresh.ok) props.onChanged(fresh.value);
	}

	async function resolveThread(thread_id: string): Promise<void> {
		const result = await client.docs.resolveThread(props.documentId, thread_id);
		if (!result.ok) return;
		const fresh = await client.docs.pull(props.documentId);
		if (fresh.ok) props.onChanged(fresh.value);
	}

	async function toggleBlocking(thread_id: string, blocking: boolean): Promise<void> {
		const result = await client.docs.toggleBlocking(props.documentId, thread_id, blocking);
		if (!result.ok) return;
		const fresh = await client.docs.pull(props.documentId);
		if (fresh.ok) props.onChanged(fresh.value);
	}

	const blockingOpenThreads = () =>
		props.pulled.threads.filter((t) => t.blocking && t.status !== "resolved" && t.status !== "addressed");

	async function decide(decision: "approved" | "changes_requested"): Promise<void> {
		const signoff = pendingSignoff();
		if (!signoff) return;
		setSaving(true);
		const result = await client.signoffs.decide(signoff.id, { decision, reason: verdictReason().trim() || undefined });
		setSaving(false);
		if (!result.ok) return;
		setVerdictReason("");
		await loadPendingSignoff();
	}

	return (
		<div class="annotation-rail" data-testid="annotation-rail">
			<Show when={pendingSignoff()}>
				<div class="verdict-bar" data-testid="verdict-bar">
					<Show when={blockingOpenThreads().length > 0}>
						<p class="verdict-blocked-note" data-testid="verdict-blocked-note">
							Blocked by {blockingOpenThreads().length} open blocking thread
							{blockingOpenThreads().length > 1 ? "s" : ""}:{" "}
							{blockingOpenThreads()
								.map((t) => `"${t.anchor.quote.slice(0, 24)}"`)
								.join(", ")}
						</p>
					</Show>
					<textarea
						class="verdict-reason"
						placeholder="Reason (optional)"
						value={verdictReason()}
						onInput={(e) => {
							setVerdictReason(e.currentTarget.value);
						}}
					/>
					<div class="verdict-actions">
						<Button
							data-testid="verdict-approve"
							disabled={saving() || blockingOpenThreads().length > 0}
							onClick={() => {
								void decide("approved");
							}}
						>
							Approve
						</Button>
						<Button
							variant="secondary"
							data-testid="verdict-request-changes"
							disabled={saving()}
							onClick={() => {
								void decide("changes_requested");
							}}
						>
							Request changes
						</Button>
					</div>
				</div>
			</Show>

			<div class="annotation-rail-header">
				<Button
					data-testid="new-thread-button"
					onClick={() => {
						captureSelection();
					}}
				>
					+ New thread from selection
				</Button>
				<Show when={selectionHint()}>
					<p class="text-xs text-faint">{selectionHint()}</p>
				</Show>
			</div>

			<Show when={pendingAnchor()}>
				{(anchor) => (
					<div class="thread-composer" data-testid="thread-composer">
						<p class="thread-quote">"{anchor().quote}"</p>
						<textarea
							placeholder="Add a note…"
							value={composerBody()}
							onInput={(e) => {
								setComposerBody(e.currentTarget.value);
							}}
						/>
						<label class="thread-blocking-label">
							<input
								type="checkbox"
								checked={composerBlocking()}
								onChange={(e) => {
									setComposerBlocking(e.currentTarget.checked);
								}}
							/>
							Blocking
						</label>
						<div class="thread-composer-actions">
							<Button
								data-testid="thread-save"
								disabled={saving() || composerBody().trim().length === 0}
								onClick={() => {
									void saveThread();
								}}
							>
								Save
							</Button>
							<Button
								variant="secondary"
								onClick={() => {
									setPendingAnchor(null);
								}}
							>
								Cancel
							</Button>
						</div>
					</div>
				)}
			</Show>

			<div class="thread-list" data-testid="thread-list">
				<For each={props.pulled.threads}>
					{(thread) => (
						<div class="thread-card" data-testid="thread-card" data-thread-id={thread.id} data-status={thread.status}>
							<p class="thread-quote">"{thread.anchor.quote}"</p>
							<div class="thread-meta">
								<span class="outline-chip">{STATUS_LABEL[thread.status]}</span>
								<Show when={thread.blocking}>
									<span class="outline-chip outline-chip-blocked">blocking</span>
								</Show>
							</div>
							<For each={thread.entries}>
								{(entry) => (
									<p class="thread-entry">
										<strong>{entry.author}</strong>: {entry.body}
									</p>
								)}
							</For>
							<Show when={thread.status !== "resolved"}>
								<div class="thread-actions">
									<button
										type="button"
										class="thread-action-link"
										onClick={() => {
											setReplyingTo(replyingTo() === thread.id ? null : thread.id);
										}}
									>
										reply
									</button>
									<button
										type="button"
										class="thread-action-link"
										data-testid="thread-resolve"
										onClick={() => {
											void resolveThread(thread.id);
										}}
									>
										resolve
									</button>
									<button
										type="button"
										class="thread-action-link"
										data-testid="thread-toggle-blocking"
										onClick={() => {
											void toggleBlocking(thread.id, !thread.blocking);
										}}
									>
										{thread.blocking ? "unmark blocking" : "mark blocking"}
									</button>
								</div>
							</Show>
							<Show when={replyingTo() === thread.id}>
								<div class="thread-reply-box">
									<textarea
										value={replyBody()}
										onInput={(e) => {
											setReplyBody(e.currentTarget.value);
										}}
									/>
									<Button
										data-testid="thread-reply-send"
										disabled={saving() || replyBody().trim().length === 0}
										onClick={() => {
											void sendReply(thread.id);
										}}
									>
										Send
									</Button>
								</div>
							</Show>
						</div>
					)}
				</For>
			</div>

			<Show when={props.pulled.orphaned.length > 0}>
				<div class="thread-list thread-list-orphaned" data-testid="orphaned-thread-list">
					<h5>Orphaned threads</h5>
					<p class="text-xs text-faint">
						The anchored text couldn't be found in the current content — never silently dropped.
					</p>
					<For each={props.pulled.orphaned}>
						{(thread) => (
							<div
								class="thread-card thread-card-orphaned"
								data-testid="orphaned-thread-card"
								data-thread-id={thread.id}
							>
								<p class="thread-quote">"{thread.anchor.quote}"</p>
								<For each={thread.entries}>
									{(entry) => (
										<p class="thread-entry">
											<strong>{entry.author}</strong>: {entry.body}
										</p>
									)}
								</For>
							</div>
						)}
					</For>
				</div>
			</Show>
		</div>
	);
}
