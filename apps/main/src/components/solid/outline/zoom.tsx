import type { Task } from "@devpad/schema";
import { For, Show } from "solid-js";
import { Ring } from "./ring";
import type { OutlineStore } from "./store";

type ZoomHeaderProps = {
	projectName: string;
	store: OutlineStore;
	onZoomTo: (id: string | null) => void;
	/** Click equivalents of the g/m shortcuts — the hintbar that documents them is hidden on touch/≤480px. */
	onOpenGraphLens: () => void;
	onOpenMilestoneLens: () => void;
};

/**
 * Breadcrumb trail + the zoomed node's own header — the outline's "you never
 * see depth, you travel it" surface. At the project root there's no ancestor
 * chain to travel and no single task to head with — the page's own h1 already
 * names the project, so the whole header is suppressed rather than rendering
 * a one-crumb bar that duplicates it.
 */
export function ZoomHeader(props: ZoomHeaderProps) {
	const chain = () => props.store.ancestors().toReversed();
	const zoomTask = () => props.store.zoomTask();

	return (
		<Show when={zoomTask()}>
			{(task) => (
				<div class="outline-zoomhead">
					<div class="outline-zoomhead-toprow">
						<nav class="outline-crumbs" data-testid="outline-crumbs" aria-label="Breadcrumb">
							<button
								type="button"
								class="outline-crumb"
								onClick={() => {
									props.onZoomTo(null);
								}}
							>
								{props.projectName}
							</button>
							<For each={chain()}>
								{(ancestor: Task) => (
									<>
										<span class="outline-crumb-sep">›</span>
										<button
											type="button"
											class="outline-crumb"
											onClick={() => {
												props.onZoomTo(ancestor.id);
											}}
										>
											{ancestor.title}
										</button>
									</>
								)}
							</For>
							<span class="outline-crumb-sep">›</span>
							<span class="outline-crumb-here">{task().title}</span>
						</nav>

						<div class="outline-lensbtns" data-testid="outline-lensbtns">
							<button type="button" class="outline-lensbtn" onClick={props.onOpenGraphLens}>
								graph <kbd class="outline-kbd">g</kbd>
							</button>
							<button type="button" class="outline-lensbtn" onClick={props.onOpenMilestoneLens}>
								milestones <kbd class="outline-kbd">m</kbd>
							</button>
						</div>
					</div>

					<div class="outline-zoom-title-row">
						<Ring
							rollup={props.store.rollups[task().id]}
							size={30}
							auto={task().completion_policy === "auto_children"}
							rippling={props.store.rippling().has(task().id)}
						/>
						<h1 class="outline-zoom-h1" data-testid="outline-zoom-title">
							{task().title}
						</h1>
						<span class="outline-chip">#{task().id}</span>
						<span class="outline-chip">{task().kind}</span>
						<Show when={task().priority === "HIGH"}>
							<span class="outline-chip outline-chip-hi">HIGH</span>
						</Show>
						<Show when={task().completion_policy === "auto_children"}>
							<span
								class="outline-chip outline-chip-auto"
								title="completion_policy: auto_children — completes when all children are done"
							>
								auto ⚙
							</span>
						</Show>
						<Show when={(props.store.rollups[task().id]?.subtree_total ?? 0) > 0}>
							<span class="outline-chip">
								{props.store.rollups[task().id]?.subtree_done}/{props.store.rollups[task().id]?.subtree_total} done
							</span>
						</Show>
					</div>
				</div>
			)}
		</Show>
	);
}
