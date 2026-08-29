import { getBrowserClient } from "@devpad/core/ui/client";
import type { DocVersionInfo, PullDocResponse } from "@devpad/api";
import { Badge, Empty } from "@f0rbit/ui";
import { createMemo, createSignal, For, Show } from "solid-js";
import { checkpointForDocKind } from "@/utils/checkpoint";
import { diffLines, docContentForDiff, type DiffLine } from "@/utils/text-diff";
import AnnotationRail from "./annotation-rail";

export type DocViewerProps = {
	documentId: string;
	/** SSR-fetched initial state — avoids a client-side waterfall on first paint. */
	initial: PullDocResponse;
	initialVersions: DocVersionInfo[];
};

const STATUS_VARIANT = { draft: "default", in_review: "warning", approved: "success" } as const;

/**
 * Task B3.1/B3.2 — DocViewer: renders the corpus-stored, already-sanitized
 * doc content inline in the `docs` tab, via a sandboxed script-disabled
 * iframe hitting `GET /docs/:id/render` (its own CSP — defense in depth
 * over sanitize-on-push, per gap 7). Version picker walks corpus lineage
 * (vN chips + an `approved` tag badge), with a diff link between adjacent
 * versions, and the AnnotationRail alongside it shares the same live
 * `pulled` state (threads/orphans) — every rail mutation mints a new corpus
 * version, so the rail hands the fresh pull straight back here to refresh
 * both the version list and the rendered iframe.
 *
 * `iframe sandbox="allow-same-origin"` (no `allow-scripts`) is the load-
 * bearing combination: it gives the PARENT frame's own trusted JS a live,
 * readable `contentDocument`/`contentWindow.getSelection()` for the
 * AnnotationRail to build selections against, while any `<script>` or
 * inline event handler that ever slipped past ingest sanitization stays
 * completely inert — script execution is gated by `allow-scripts` alone,
 * independent of same-origin access.
 *
 * Plain signals + explicit async functions (not `createResource`) — matches
 * every other Solid component in this codebase (`milestone-lens.tsx` etc);
 * no component here uses `createResource`.
 */
export default function DocViewer(props: DocViewerProps) {
	const client = getBrowserClient();
	let iframeRef: HTMLIFrameElement | undefined;

	const [pulled, setPulled] = createSignal<PullDocResponse>(props.initial);
	const [versions, setVersions] = createSignal<DocVersionInfo[]>(props.initialVersions);
	const [selectedVersion, setSelectedVersion] = createSignal<string | undefined>(
		props.initial.document.head_version ?? undefined,
	);
	const [diffData, setDiffData] = createSignal<{ against: string; lines: DiffLine[] } | null>(null);
	const [diffLoading, setDiffLoading] = createSignal(false);
	// B3 fast-follow #5 (taste/IA critic — "save feedback + reading
	// position"): a rail mutation bumps `selectedVersion` to the new head,
	// which changes `renderUrl()` and forces the iframe to navigate — losing
	// the reader's scroll position on every save. Captured right before the
	// navigation, restored on the iframe's own `load` event (the earliest
	// point its `contentWindow` is valid again).
	let pendingScrollRestore: number | null = null;
	const [justSavedVersion, setJustSavedVersion] = createSignal<string | null>(null);

	/** Oldest-first ordinal labels (v1 = oldest) — `versions()` itself is newest-first (the lineage walk). */
	const versionLabel = (version: string) => {
		const list = versions();
		const idxFromNewest = list.findIndex((v) => v.version === version);
		return idxFromNewest === -1 ? "?" : String(list.length - idxFromNewest);
	};

	async function showDiff(current: string, against: string): Promise<void> {
		setSelectedVersion(current);
		setDiffLoading(true);
		const [a, b] = await Promise.all([
			client.docs.pull(props.documentId, against),
			client.docs.pull(props.documentId, current),
		]);
		if (a.ok && b.ok && a.value.content && b.value.content) {
			const kind = pulled().document.kind;
			setDiffData({
				against,
				lines: diffLines(docContentForDiff(a.value.content.html, kind), docContentForDiff(b.value.content.html, kind)),
			});
		}
		setDiffLoading(false);
	}

	/** A rail mutation minted a new corpus version — refresh both the version list and jump the viewer to the new head. */
	async function handleAnnotationChange(fresh: PullDocResponse): Promise<void> {
		pendingScrollRestore = iframeRef?.contentWindow?.scrollY ?? 0;
		setPulled(fresh);
		setSelectedVersion(fresh.document.head_version ?? undefined);
		setDiffData(null);
		if (fresh.document.head_version) {
			setJustSavedVersion(fresh.document.head_version);
			setTimeout(() => setJustSavedVersion(null), 4000);
		}
		const versions_result = await client.docs.versions(props.documentId);
		if (versions_result.ok) setVersions(versions_result.value);
	}

	function onFrameLoad(): void {
		if (pendingScrollRestore === null) return;
		iframeRef?.contentWindow?.scrollTo(0, pendingScrollRestore);
		pendingScrollRestore = null;
	}

	const renderUrl = createMemo(() => client.docs.renderUrl(props.documentId, selectedVersion()));
	const checkpoint = createMemo(() => checkpointForDocKind(pulled().document.kind));

	return (
		<div class="doc-viewer" data-testid="doc-viewer">
			<div class="doc-viewer-header">
				<h4 class="doc-viewer-title">{pulled().document.title}</h4>
				<Badge variant={STATUS_VARIANT[pulled().document.status]}>{pulled().document.status}</Badge>
				<span class="outline-chip">{pulled().document.kind}</span>
			</div>

			<Show when={versions().length > 0}>
				<div class="doc-version-picker" data-testid="doc-version-picker">
					<For each={versions()}>
						{(v, i) => (
							<span class="doc-version-chip-group">
								<button
									type="button"
									class={`doc-version-chip${selectedVersion() === v.version ? " doc-version-chip-active" : ""}`}
									data-testid="doc-version-chip"
									data-version={v.version}
									onClick={() => {
										setSelectedVersion(v.version);
										setDiffData(null);
									}}
								>
									v{versionLabel(v.version)}
									{/* B3 fast-follow #5 — save feedback: the version just minted by a rail mutation gets a transient "· just now" label instead of looking like every other chip. */}
									<Show when={v.version === justSavedVersion()}>
										<span class="doc-version-just-now" data-testid="doc-version-just-now">
											· just now
										</span>
									</Show>
									<Show when={v.tags.includes("approved")}>
										<span class="doc-version-approved" title="approved">
											✓
										</span>
									</Show>
								</button>
								<Show when={i() < versions().length - 1}>
									{/* Craft fast-follow #13b — icon-only diff affordance between chips, not a text label crowding the version picker row. */}
									<button
										type="button"
										class="doc-version-diff-link"
										data-testid="doc-version-diff-link"
										title="Diff vs previous version"
										aria-label="Diff vs previous version"
										onClick={() => {
											void showDiff(v.version, versions()[i() + 1]?.version ?? v.version);
										}}
									>
										⇆
									</button>
								</Show>
							</span>
						)}
					</For>
				</div>
			</Show>

			<Show when={diffLoading() || diffData()}>
				<div class="doc-diff-panel" data-testid="doc-diff-panel">
					<Show when={!diffLoading()} fallback={<p class="text-sm text-faint">Loading diff…</p>}>
						<pre class="doc-diff-pre">
							<For each={diffData()?.lines ?? []}>
								{(line) => (
									<div
										class={`doc-diff-line${line.kind === "add" ? " doc-diff-add" : line.kind === "remove" ? " doc-diff-remove" : ""}`}
									>
										{line.kind === "add" ? "+ " : line.kind === "remove" ? "- " : "  "}
										{line.text}
									</div>
								)}
							</For>
						</pre>
					</Show>
				</div>
			</Show>

			<div class="doc-viewer-body">
				<Show
					when={pulled().document.head_version}
					fallback={<Empty title="No content yet" description="This document hasn't been pushed to." />}
				>
					<iframe
						ref={iframeRef}
						class="doc-render-frame"
						data-testid="doc-render-frame"
						title={pulled().document.title}
						src={renderUrl()}
						sandbox="allow-same-origin"
						onLoad={onFrameLoad}
					/>
					<Show
						when={selectedVersion() === pulled().document.head_version}
						fallback={
							<p class="text-sm text-faint doc-viewer-not-head-note">
								Viewing an older version — switch to the latest version to annotate or decide.
							</p>
						}
					>
						<AnnotationRail
							documentId={props.documentId}
							pulled={pulled()}
							checkpoint={checkpoint()}
							getIframe={() => iframeRef}
							onChanged={(fresh) => {
								void handleAnnotationChange(fresh);
							}}
						/>
					</Show>
				</Show>
			</div>
		</div>
	);
}
