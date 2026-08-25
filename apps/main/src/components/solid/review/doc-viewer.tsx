import { getBrowserClient } from "@devpad/core/ui/client";
import type { DocVersionInfo, PullDocResponse } from "@devpad/api";
import { Badge, Empty } from "@f0rbit/ui";
import { createMemo, createSignal, For, Show } from "solid-js";
import { diffLines, type DiffLine } from "@/utils/text-diff";

export type DocViewerProps = {
	documentId: string;
	/** SSR-fetched initial state — avoids a client-side waterfall on first paint. */
	initial: PullDocResponse;
	initialVersions: DocVersionInfo[];
};

const STATUS_VARIANT = { draft: "default", in_review: "warning", approved: "success" } as const;

/**
 * Task B3.1 — DocViewer: renders the corpus-stored, already-sanitized doc
 * content inline in the `docs` tab, via a sandboxed script-disabled iframe
 * hitting `GET /docs/:id/render` (its own CSP — defense in depth over
 * sanitize-on-push, per gap 7). Version picker walks corpus lineage (vN
 * chips + an `approved` tag badge), with a diff link between adjacent
 * versions.
 *
 * `iframe sandbox="allow-same-origin"` (no `allow-scripts`) is the load-
 * bearing combination: it gives the PARENT frame's own trusted JS a live,
 * readable `contentDocument`/`contentWindow.getSelection()` for the
 * AnnotationRail (task B3.2) to build selections against, while any
 * `<script>` or inline event handler that ever slipped past ingest
 * sanitization stays completely inert — script execution is gated by
 * `allow-scripts` alone, independent of same-origin access.
 *
 * Plain signals + explicit async functions (not `createResource`) — matches
 * every other Solid component in this codebase (`milestone-lens.tsx` etc);
 * no component here uses `createResource`.
 */
export default function DocViewer(props: DocViewerProps) {
	const client = getBrowserClient();
	const [selectedVersion, setSelectedVersion] = createSignal<string | undefined>(
		props.initial.document.head_version ?? undefined,
	);
	const [diffData, setDiffData] = createSignal<{ against: string; lines: DiffLine[] } | null>(null);
	const [diffLoading, setDiffLoading] = createSignal(false);

	const versions = createMemo(() => props.initialVersions);
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
			setDiffData({ against, lines: diffLines(a.value.content.html, b.value.content.html) });
		}
		setDiffLoading(false);
	}

	const renderUrl = createMemo(() => client.docs.renderUrl(props.documentId, selectedVersion()));

	return (
		<div class="doc-viewer" data-testid="doc-viewer">
			<div class="doc-viewer-header">
				<h4 class="doc-viewer-title">{props.initial.document.title}</h4>
				<Badge variant={STATUS_VARIANT[props.initial.document.status]}>{props.initial.document.status}</Badge>
				<span class="outline-chip">{props.initial.document.kind}</span>
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
									<Show when={v.tags.includes("approved")}>
										<span class="doc-version-approved" title="approved">
											✓
										</span>
									</Show>
								</button>
								<Show when={i() < versions().length - 1}>
									<button
										type="button"
										class="doc-version-diff-link"
										data-testid="doc-version-diff-link"
										onClick={() => {
											void showDiff(v.version, versions()[i() + 1]?.version ?? v.version);
										}}
									>
										diff vs previous
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

			<Show
				when={props.initial.document.head_version}
				fallback={<Empty title="No content yet" description="This document hasn't been pushed to." />}
			>
				<iframe
					class="doc-render-frame"
					data-testid="doc-render-frame"
					title={props.initial.document.title}
					src={renderUrl()}
					sandbox="allow-same-origin"
				/>
			</Show>
		</div>
	);
}
