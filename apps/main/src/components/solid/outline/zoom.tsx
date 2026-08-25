import type { Task } from "@devpad/schema";
import { For, Show } from "solid-js";
import { Ring } from "./ring";
import type { OutlineStore } from "./store";

type ZoomHeaderProps = {
	projectName: string;
	store: OutlineStore;
	onZoomTo: (id: string | null) => void;
};

/**
 * Breadcrumb trail + (when zoomed) the zoomed node's own header — the outline's
 * "you never see depth, you travel it" surface. At the project root there's no
 * single task to head with, so only the crumb bar renders.
 */
export function ZoomHeader(props: ZoomHeaderProps) {
	const chain = () => props.store.ancestors().toReversed();
	const zoomTask = () => props.store.zoomTask();

	return (
		<div class="outline-zoomhead">
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
				<Show when={zoomTask()}>
					{(task) => (
						<>
							<span class="outline-crumb-sep">›</span>
							<span class="outline-crumb-here">{task().title}</span>
						</>
					)}
				</Show>
			</nav>

			<Show when={zoomTask()}>
				{(task) => (
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
						<span class="outline-chip">{task().kind}</span>
						<Show when={(props.store.rollups[task().id]?.subtree_total ?? 0) > 0}>
							<span class="outline-chip">
								{props.store.rollups[task().id]?.subtree_done}/{props.store.rollups[task().id]?.subtree_total} done
							</span>
						</Show>
					</div>
				)}
			</Show>
		</div>
	);
}
