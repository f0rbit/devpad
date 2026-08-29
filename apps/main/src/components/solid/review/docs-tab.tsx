import { getBrowserClient } from "@devpad/core/ui/client";
import type { DocVersionInfo, PullDocResponse } from "@devpad/api";
import type { Document } from "@devpad/schema";
import { Badge } from "@f0rbit/ui";
import { createSignal, For, onMount, Show } from "solid-js";
import { formatRelativeTime } from "@/utils/time-utils";
import DocViewer from "./doc-viewer";

export type DocsTabProps = { docs: Document[]; initialDocId?: string | null };

const STATUS_VARIANT = { draft: "default", in_review: "warning", approved: "success" } as const;

type SelectedDoc = { id: string; initial: PullDocResponse; initialVersions: DocVersionInfo[] };

/** Task B3.1/B3.3 — the `docs` tab's interactive list: selecting a document renders its DocViewer below, in place (no navigation — lenses/overlays convention extended to this tab). `initialDocId` (from `?doc=` — see reviews.ts) auto-opens a document on load, so "Waiting on you" cards can deep-link straight to a checkpoint's DocViewer. */
export default function DocsTab(props: DocsTabProps) {
	const [selected, setSelected] = createSignal<SelectedDoc | null>(null);
	const [loadingId, setLoadingId] = createSignal<string | null>(null);
	const [loadError, setLoadError] = createSignal<string | null>(null);

	async function select(id: string): Promise<void> {
		setLoadingId(id);
		setLoadError(null);
		const client = getBrowserClient();
		const [pulled, versions] = await Promise.all([client.docs.pull(id), client.docs.versions(id)]);
		if (pulled.ok && versions.ok) {
			setSelected({ id, initial: pulled.value, initialVersions: versions.value });
		} else {
			setLoadError(!pulled.ok ? pulled.error.message : !versions.ok ? versions.error.message : "Unknown error");
		}
		setLoadingId(null);
	}

	onMount(() => {
		if (props.initialDocId) void select(props.initialDocId);
	});

	return (
		<section class="docs-list">
			<h5>project documents</h5>
			<Show
				when={props.docs.length > 0}
				fallback={
					<p class="text-sm text-faint">
						No documents pushed yet — plans, design docs, and interface reports land here as they're generated.
					</p>
				}
			>
				{/* Fast-follow #9 (taste/IA critic) — once a doc is open below, the
				list collapses to a compact strip: the open row stays legible, the
				rest shrink to title-only so the DocViewer (the thing being worked
				on) gets the vertical space instead of a full-height list beside it. */}
				<ul class={`list${selected() ? " docs-list--compact" : ""}`}>
					<For each={props.docs}>
						{(doc) => {
							const isActive = () => selected()?.id === doc.id;
							return (
								<li class="docs-list__item" aria-current={isActive() ? "true" : undefined}>
									<button
										type="button"
										class="docs-list__link"
										data-testid="doc-list-item"
										data-document-id={doc.id}
										onClick={() => {
											void select(doc.id);
										}}
									>
										<span class="docs-list__title">{doc.title}</span>
									</button>
									<Badge variant={STATUS_VARIANT[doc.status]}>{doc.status}</Badge>
									<span class="text-xs text-faint">{doc.kind}</span>
									<span class="text-xs text-faint docs-list__updated">
										updated {formatRelativeTime(new Date(doc.updated_at))}
									</span>
								</li>
							);
						}}
					</For>
				</ul>
			</Show>

			<Show when={loadingId()}>
				<p class="text-sm text-faint">Loading document…</p>
			</Show>
			<Show when={loadError()}>
				<p class="text-sm" style={{ color: "var(--error-fg)" }} data-testid="docs-tab-load-error">
					Couldn't load that document: {loadError()}
				</p>
			</Show>
			{/* `keyed` — a plain `Show` only re-runs its callback on falsy→truthy
			transitions; selecting a SECOND, different document would otherwise
			leave DocViewer's own once-initialized signals (selectedVersion etc.)
			pointed at the FIRST document. `keyed` disposes + remounts whenever
			`selected()` resolves to a new object, giving each selection a clean
			DocViewer instance. */}
			<Show when={selected()} keyed>
				{(data) => <DocViewer documentId={data.id} initial={data.initial} initialVersions={data.initialVersions} />}
			</Show>
		</section>
	);
}
