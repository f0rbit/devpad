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
	// Craft fast-follow #13e (taste/IA critic) — a single shared signal here
	// leaked one thread's in-progress reply draft into whichever thread you
	// opened next. Keyed by thread id so each thread's draft is independent.
	const [replyDrafts, setReplyDrafts] = createSignal<Record<string, string>>({});
	const replyBody = (thread_id: string) => replyDrafts()[thread_id] ?? "";
	const setReplyBody = (thread_id: string, value: string) => {
		setReplyDrafts((prev) => ({ ...prev, [thread_id]: value }));
	};
	const clearReplyBody = (thread_id: string) => {
		setReplyDrafts((prev) => {
			const { [thread_id]: _removed, ...rest } = prev;
			return rest;
		});
	};
	const [saving, setSaving] = createSignal(false);
	const [selectionHint, setSelectionHint] = createSignal<string | null>(null);
	const [pendingSignoff, setPendingSignoff] = createSignal<Signoff | null>(null);
	const [verdictReason, setVerdictReason] = createSignal("");
	const [mutationError, setMutationError] = createSignal<string | null>(null);

	async function loadPendingSignoff(): Promise<void> {
		const result = await client.signoffs.findPending({
			subject_kind: "doc_version",
			subject_id: props.documentId,
			checkpoint: props.checkpoint,
		});
		setPendingSignoff(result.ok ? result.value : null);
	}
	onMount(() => void loadPendingSignoff());

	/**
	 * B3 fast-follow #4 — "anchor connection". The render route wraps each
	 * paired thread's text in `<mark data-thread-id>` (see `docs/markers.ts`'s
	 * `markers_to_marks`); hovering/clicking a rail thread card scrolls the
	 * iframe to its mark and flashes it. Orphaned threads have no mark to
	 * find (their anchor text wasn't located in the current content) — a
	 * missed `querySelector` is a silent no-op, not an error.
	 *
	 * `mark` is a node from the IFRAME's own realm — `instanceof HTMLElement`
	 * checks against THIS window's `HTMLElement` constructor, which a
	 * cross-realm element is never an instance of (each browsing context has
	 * its own global object graph), so that check silently no-ops on every
	 * call. A plain null check is correct here: `scrollIntoView`/`classList`
	 * are on `Element`, not `HTMLElement`-specific.
	 */
	function scrollToMark(thread_id: string): void {
		const doc = props.getIframe()?.contentDocument;
		const mark = doc?.querySelector(`mark[data-thread-id="${CSS.escape(thread_id)}"]`);
		if (!mark) return;
		mark.scrollIntoView({ behavior: "smooth", block: "center" });
		mark.classList.add("mark-flash");
		setTimeout(() => {
			mark.classList.remove("mark-flash");
		}, 1200);
	}

	/**
	 * B3 fast-follow #7 — "orphan threads get the SAME action row as live
	 * threads … visible must not mean dead-ended". `resolveThread`/
	 * `sendReply`/`toggleBlocking` all now resolve against `mutate_thread`'s
	 * paired-then-orphaned lookup server-side (see `threads.ts`), so this
	 * markup is identical for a live or orphaned thread — no branching needed
	 * beyond `thread.status !== "resolved"`, already true for an "orphaned"
	 * status marker.
	 */
	function ThreadActionsAndReply(thread: ThreadMarker) {
		return (
			<>
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
							value={replyBody(thread.id)}
							onInput={(e) => {
								setReplyBody(thread.id, e.currentTarget.value);
							}}
						/>
						<Button
							data-testid="thread-reply-send"
							disabled={saving() || replyBody(thread.id).trim().length === 0}
							onClick={() => {
								void sendReply(thread.id);
							}}
						>
							Send
						</Button>
					</div>
				</Show>
			</>
		);
	}

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

	/** Re-pulls after a mutation succeeds; a failed pull still surfaces (the mutation itself landed, but the rail's view of it can't refresh) rather than leaving the UI silently stale. */
	async function refreshAfterMutation(): Promise<void> {
		const fresh = await client.docs.pull(props.documentId);
		if (fresh.ok) props.onChanged(fresh.value);
		else setMutationError(`Saved, but couldn't refresh: ${fresh.error.message}`);
	}

	async function saveThread(): Promise<void> {
		const anchor = pendingAnchor();
		const body = composerBody().trim();
		if (!anchor || !body) return;
		setSaving(true);
		setMutationError(null);
		// A concurrent edit to this document between selecting the text and
		// saving (another reviewer, or an agent pushing a new version) can make
		// this create fail server-side — surfaced here, never a silent no-op
		// that leaves the user thinking their note was saved.
		const result = await client.docs.createThread(props.documentId, { ...anchor, body, blocking: composerBlocking() });
		setSaving(false);
		if (!result.ok) {
			setMutationError(`Couldn't save the thread: ${result.error.message}`);
			return;
		}
		setPendingAnchor(null);
		setComposerBody("");
		setComposerBlocking(false);
		await refreshAfterMutation();
	}

	async function sendReply(thread_id: string): Promise<void> {
		const body = replyBody(thread_id).trim();
		if (!body) return;
		setSaving(true);
		setMutationError(null);
		const result = await client.docs.replyThread(props.documentId, thread_id, body);
		setSaving(false);
		if (!result.ok) {
			setMutationError(`Couldn't send the reply: ${result.error.message}`);
			return;
		}
		setReplyingTo(null);
		clearReplyBody(thread_id);
		await refreshAfterMutation();
	}

	async function resolveThread(thread_id: string): Promise<void> {
		setMutationError(null);
		const result = await client.docs.resolveThread(props.documentId, thread_id);
		if (!result.ok) {
			setMutationError(`Couldn't resolve the thread: ${result.error.message}`);
			return;
		}
		await refreshAfterMutation();
	}

	async function toggleBlocking(thread_id: string, blocking: boolean): Promise<void> {
		setMutationError(null);
		const result = await client.docs.toggleBlocking(props.documentId, thread_id, blocking);
		if (!result.ok) {
			setMutationError(`Couldn't update blocking: ${result.error.message}`);
			return;
		}
		await refreshAfterMutation();
	}

	const blockingOpenThreads = () =>
		props.pulled.threads.filter((t) => t.blocking && t.status !== "resolved" && t.status !== "addressed");

	async function decide(decision: "approved" | "changes_requested"): Promise<void> {
		const signoff = pendingSignoff();
		if (!signoff) return;
		setSaving(true);
		setMutationError(null);
		const result = await client.signoffs.decide(signoff.id, { decision, reason: verdictReason().trim() || undefined });
		setSaving(false);
		if (!result.ok) {
			setMutationError(`Couldn't record the decision: ${result.error.message}`);
			return;
		}
		setVerdictReason("");
		await loadPendingSignoff();
	}

	return (
		<div class="annotation-rail" data-testid="annotation-rail">
			<Show when={mutationError()}>
				<p class="verdict-blocked-note" data-testid="annotation-mutation-error">
					{mutationError()}
				</p>
			</Show>
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
							variant="primary"
							data-testid="verdict-approve"
							disabled={saving() || blockingOpenThreads().length > 0}
							onClick={() => {
								void decide("approved");
							}}
						>
							Approve
						</Button>
						<Button
							variant="ghost"
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
				{(anchor) => {
					// B3 fast-follow #11 — a non-`keyed` `Show` only reruns its
					// callback on a falsy→truthy transition (AGENTS.md's B3 lesson),
					// which is exactly "the composer just opened" — the right moment
					// to autofocus, and the right owner scope for this `onMount`.
					let bodyRef: HTMLTextAreaElement | undefined;
					onMount(() => bodyRef?.focus());
					return (
						<div class="thread-composer" data-testid="thread-composer">
							<p class="thread-quote">"{anchor().quote}"</p>
							<textarea
								placeholder="Add a note…"
								value={composerBody()}
								ref={bodyRef}
								onKeyDown={(e) => {
									if (e.key === "Escape") setPendingAnchor(null);
								}}
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
					);
				}}
			</Show>

			<div class="thread-list" data-testid="thread-list">
				<For each={props.pulled.threads}>
					{(thread) => (
						<div
							class="thread-card"
							data-testid="thread-card"
							data-thread-id={thread.id}
							data-status={thread.status}
							onMouseEnter={() => {
								scrollToMark(thread.id);
							}}
						>
							<p
								class="thread-quote"
								data-testid="thread-quote"
								onClick={() => {
									scrollToMark(thread.id);
								}}
							>
								"{thread.anchor.quote}"
							</p>
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
							{ThreadActionsAndReply(thread)}
						</div>
					)}
				</For>
			</div>

			<Show when={props.pulled.orphaned.length > 0}>
				<div class="thread-list thread-list-orphaned" data-testid="orphaned-thread-list">
					<h5>Orphaned threads</h5>
					<p class="text-xs text-faint">
						The anchored text couldn't be found in the current content — kept here so nothing is lost.
					</p>
					<For each={props.pulled.orphaned}>
						{(thread) => (
							<div
								class="thread-card thread-card-orphaned"
								data-testid="orphaned-thread-card"
								data-thread-id={thread.id}
								data-status={thread.status}
							>
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
								{ThreadActionsAndReply(thread)}
							</div>
						)}
					</For>
				</div>
			</Show>
		</div>
	);
}
