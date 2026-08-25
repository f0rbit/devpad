import { getBrowserClient } from "@devpad/core/ui/client";
import type { Task } from "@devpad/schema";
import { Button, Empty, Input, Tree } from "@f0rbit/ui";
import Plus from "lucide-solid/icons/plus";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { track } from "@/lib/pulse";
import { loadOutline } from "@/utils/outline-data";
import { Rail } from "./rail";
import { OutlineRow } from "./row";
import { createOutlineStore, type OutlineStoreInput } from "./store";
import { hasChildren, isCompactSummary, isMoreSummary, type OutlineTreeNode } from "./types";
import { ZoomHeader } from "./zoom";

export type OutlineProps = {
	project: { id: string; name: string };
	ownerId: string;
	initial: Omit<OutlineStoreInput, "ownerId" | "projectId">;
};

function CompactRow(props: { count: number; onOpen: () => void; selected: boolean }) {
	return (
		<button
			type="button"
			class={`outline-compact-row${props.selected ? " outline-row-selected" : ""}`}
			onClick={props.onOpen}
		>
			<span class="outline-dot outline-dot-done" />
			<span>{props.count} done · compacted</span>
			<span class="outline-compact-line" />
			<span>expand</span>
		</button>
	);
}

function MoreRow(props: { remaining: number; onOpen: () => void; selected: boolean }) {
	return (
		<button
			type="button"
			class={`outline-compact-row${props.selected ? " outline-row-selected" : ""}`}
			onClick={props.onOpen}
		>
			<span class="outline-compact-line" />
			<span>show {props.remaining} more</span>
		</button>
	);
}

function pushNodeParam(nodeId: string | null) {
	const url = new URL(window.location.href);
	if (nodeId) url.searchParams.set("node", nodeId);
	else url.searchParams.delete("node");
	window.history.pushState({}, "", url);
}

export default function Outline(props: OutlineProps) {
	const store = createOutlineStore({ ownerId: props.ownerId, projectId: props.project.id, ...props.initial });
	const [quickAdd, setQuickAdd] = createSignal("");
	const [quickAddOpen, setQuickAddOpen] = createSignal(false);
	let containerRef: HTMLDivElement | undefined;
	// Set while replaying a popstate — history already moved, so navigateTo must
	// not push a duplicate entry on top of it.
	let suppressPush = false;

	onMount(() => {
		containerRef?.focus();
		const onPopState = () => {
			suppressPush = true;
			void navigateTo(new URL(window.location.href).searchParams.get("node")).finally(() => {
				suppressPush = false;
			});
		};
		window.addEventListener("popstate", onPopState);
		onCleanup(() => {
			window.removeEventListener("popstate", onPopState);
		});
	});

	const navigateTo = async (nodeId: string | null, selectAfter: string | null = null) => {
		const data = await loadOutline(getBrowserClient(), props.project.id, nodeId);
		if (!data) {
			store.toast("Couldn't load that node", "error");
			return;
		}
		store.resetView(data, selectAfter);
		if (!suppressPush) pushNodeParam(nodeId);
		track("outline_zoomed", { project_id: props.project.id, node_id: nodeId ?? "root" });
	};

	/** Zooming out keeps context — the node you zoomed out FROM stays selected. */
	const zoomOut = () => {
		const ancestors = store.ancestors();
		void navigateTo(ancestors[0]?.id ?? null, store.zoomTask()?.id ?? null);
	};

	const submitQuickAdd = async () => {
		const title = quickAdd();
		if (!title.trim()) return;
		await store.addChild(store.zoomTask()?.id ?? null, title);
		setQuickAdd("");
		setQuickAddOpen(false);
		// The input closes but keyboard focus is left dangling in the (now
		// removed) element unless explicitly returned to the container — every
		// other shortcut (j/k, space, Enter-to-rename, tab reparent) is guarded
		// against firing while a text input has focus, so a stray focus here
		// would silently swallow every keystroke for the rest of the session.
		containerRef?.focus();
	};

	const onKeyDown = (e: KeyboardEvent) => {
		const target = e.target as HTMLElement;
		if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

		const selected = store.selected();

		if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
			e.preventDefault();
			if (!selected || !store.tasks[selected]) return;
			void store.moveSibling(selected, e.key === "ArrowUp" ? "up" : "down");
			return;
		}
		if (e.key === "j" || e.key === "ArrowDown") {
			e.preventDefault();
			store.selectDelta(1);
			return;
		}
		if (e.key === "k" || e.key === "ArrowUp") {
			e.preventDefault();
			store.selectDelta(-1);
			return;
		}
		if (e.key === " ") {
			e.preventDefault();
			if (!selected) return;
			if (selected.endsWith("__compact")) {
				store.reopenCompacted(selected.replace(/__compact$/, ""));
				return;
			}
			if (selected.endsWith("__more")) {
				store.showMore(selected.replace(/__more$/, ""));
				return;
			}
			void store.advance(selected);
			return;
		}
		if (e.key === "z" && !e.shiftKey) {
			if (selected && store.tasks[selected] && hasChildren(selected, store.tasks)) void navigateTo(selected);
			return;
		}
		if (e.key === "Z" || (e.key === "z" && e.shiftKey)) {
			zoomOut();
			return;
		}
		if (e.key === "Escape") {
			if (store.zoomTask()) zoomOut();
			return;
		}
		if (e.key === "o") {
			e.preventDefault();
			setQuickAddOpen(true);
			return;
		}
		if (e.key === "Enter") {
			if (selected && store.tasks[selected]) store.startRename(selected);
			return;
		}
		if (e.key === "Tab") {
			if (!selected || !store.tasks[selected]) return;
			e.preventDefault();
			void store.reparent(selected, e.shiftKey ? "out" : "in");
		}
	};

	const selectedTask = (): Task | null => {
		const id = store.selected();
		return id ? (store.tasks[id] ?? null) : null;
	};

	const renderNode = (node: OutlineTreeNode) => {
		if (isCompactSummary(node.data)) {
			const data = node.data;
			return (
				<CompactRow
					count={data.count}
					selected={store.selected() === node.id}
					onOpen={() => store.reopenCompacted(data.compactSummaryFor)}
				/>
			);
		}
		if (isMoreSummary(node.data)) {
			const data = node.data;
			return (
				<MoreRow
					remaining={data.remaining}
					selected={store.selected() === node.id}
					onOpen={() => store.showMore(data.moreFor)}
				/>
			);
		}
		if (!node.data) return null;
		return <OutlineRow task={node.data.task} store={store} onZoom={(id) => void navigateTo(id)} />;
	};

	return (
		<div ref={containerRef} class="outline-container" data-testid="outline" tabIndex={0} onKeyDown={onKeyDown}>
			<ZoomHeader
				projectName={props.project.name}
				store={store}
				onZoomTo={(id) => void navigateTo(id, store.zoomTask()?.id ?? null)}
			/>

			<div class="outline-layout">
				<div class="outline-main">
					<Show
						when={store.nodes().length > 0}
						fallback={<Empty title="No tasks yet" description="Add your first task to get started." />}
					>
						<Tree
							nodes={store.nodes()}
							expanded={[...store.expanded()]}
							onExpandedChange={(ids) => store.setExpandedAll(ids)}
							renderNode={renderNode}
							showGuides
							class="outline-tree"
						/>
					</Show>

					<Show
						when={quickAddOpen()}
						fallback={
							<Button variant="ghost" size="sm" onClick={() => setQuickAddOpen(true)}>
								<Plus size={14} /> add child <span class="outline-kbd">o</span>
							</Button>
						}
					>
						<div class="outline-row" style={{ "padding-left": "4px" }}>
							<Input
								autofocus
								value={quickAdd()}
								placeholder="New task title…"
								onInput={(e) => setQuickAdd(e.currentTarget.value)}
								onKeyDown={(e) => {
									e.stopPropagation();
									if (e.key === "Enter") void submitQuickAdd();
									if (e.key === "Escape") {
										setQuickAdd("");
										setQuickAddOpen(false);
									}
								}}
								onBlur={() => {
									if (!quickAdd().trim()) setQuickAddOpen(false);
								}}
							/>
						</div>
					</Show>
				</div>

				<Rail selectedTask={selectedTask()} rollups={store.rollups} onNavigate={(id) => void navigateTo(id)} />
			</div>

			<div class="outline-hintbar">
				<span>
					<b>j/k</b> select
				</span>
				<span>
					<b>space</b> advance
				</span>
				<span>
					<b>z</b> zoom in
				</span>
				<span>
					<b>⇧z</b> zoom out
				</span>
				<span>
					<b>tab</b> nest
				</span>
				<span>
					<b>⌥↑/↓</b> reorder
				</span>
				<span>
					<b>o</b> add child
				</span>
			</div>

			<div class="outline-toasts">
				<For each={store.toasts()}>
					{(t) => (
						<div class={`outline-toast outline-toast-${t.kind}${t.leaving ? " outline-toast-leaving" : ""}`}>
							{t.message}
						</div>
					)}
				</For>
			</div>
		</div>
	);
}
