import type { Task } from "@devpad/schema";
import { Badge } from "@f0rbit/ui";
import Layers from "lucide-solid/icons/layers";
import MilestoneIcon from "lucide-solid/icons/milestone";
import PenLine from "lucide-solid/icons/pen-line";
import Target from "lucide-solid/icons/target";
import { type Component, createEffect, createSignal, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import { Ring } from "./ring";
import type { OutlineStore } from "./store";
import { hasChildren as computeHasChildren } from "./types";

type IconComponent = Component<{ size: number }>;
const KIND_ICON: Partial<Record<Task["kind"], IconComponent>> = {
	phase: Layers,
	milestone: MilestoneIcon,
	goal: Target,
	approval: PenLine,
};

type OutlineRowProps = {
	task: Task;
	store: OutlineStore;
	onZoom: (id: string) => void;
};

export function OutlineRow(props: OutlineRowProps) {
	const [draft, setDraft] = createSignal("");
	let cancelledRef = false;

	const task = () => props.task;
	const isChildful = () => computeHasChildren(task().id, props.store.tasks);
	const isSelected = () => props.store.selected() === task().id;
	const isRenaming = () => props.store.renamingId() === task().id;
	const isPending = () => props.store.pending().has(task().id);
	const isRippling = () => props.store.rippling().has(task().id);
	const Icon = () => KIND_ICON[task().kind];
	const edge = () => props.store.edgeSummary[task().id];

	createEffect(() => {
		if (isRenaming()) setDraft(task().title);
	});

	const commitRename = () => void props.store.commitRename(task().id, draft());

	const onBulletClick = (e: MouseEvent) => {
		e.stopPropagation();
		if (isChildful()) props.onZoom(task().id);
		else void props.store.advance(task().id);
	};

	return (
		<div
			class={`outline-row${isSelected() ? " outline-row-selected" : ""}${task().progress === "COMPLETED" ? " outline-row-done" : ""}`}
			data-task-id={task().id}
			onClick={() => props.store.select(task().id)}
		>
			<button
				type="button"
				class="outline-bullet"
				disabled={isPending()}
				title={
					isChildful()
						? "Zoom into node (z)"
						: task().kind === "approval"
							? "Approve (sign-off)"
							: "Advance status (space)"
				}
				aria-label={
					isChildful() ? `Zoom into ${task().title}` : `${task().title} — ${task().progress}, click to advance`
				}
				onClick={onBulletClick}
			>
				<Show
					when={isChildful()}
					fallback={
						task().kind === "approval" ? (
							<span class={`outline-approval${task().progress === "COMPLETED" ? " outline-approval-done" : ""}`}>
								<PenLine size={11} />
							</span>
						) : (
							<span
								class={`outline-dot${task().progress === "IN_PROGRESS" ? " outline-dot-doing" : task().progress === "COMPLETED" ? " outline-dot-done" : ""}`}
							/>
						)
					}
				>
					<Ring
						rollup={props.store.rollups[task().id]}
						size={21}
						auto={task().completion_policy === "auto_children"}
						rippling={isRippling()}
					/>
				</Show>
			</button>

			<Show when={Icon()}>{(icon) => <Dynamic component={icon()} size={13} />}</Show>

			<Show
				when={!isRenaming()}
				fallback={
					<input
						class="outline-rename-input"
						value={draft()}
						autofocus
						onInput={(e) => setDraft(e.currentTarget.value)}
						onBlur={(e) => {
							// The input unmounts once renaming clears either way; browsers park
							// focus on <body> when a focused element is removed, silently
							// swallowing every subsequent keyboard shortcut until the user
							// clicks back in — restore it to the outline explicitly. Escape
							// already cancelled (and cleared `cancelled`) before this fires.
							const container = e.currentTarget.closest<HTMLElement>(".outline-container");
							if (!cancelledRef) commitRename();
							cancelledRef = false;
							container?.focus();
						}}
						onKeyDown={(e) => {
							e.stopPropagation();
							if (e.key === "Enter") e.currentTarget.blur();
							if (e.key === "Escape") {
								cancelledRef = true;
								props.store.cancelRename();
								e.currentTarget.blur();
							}
						}}
					/>
				}
			>
				<button type="button" class="outline-title" onDblClick={() => props.store.startRename(task().id)}>
					{task().title}
				</button>
			</Show>

			<span class="outline-chips">
				<Show when={task().priority === "HIGH"}>
					<span class="outline-chip outline-chip-hi">HIGH</span>
				</Show>
				<Show when={task().priority === "LOW"}>
					<span class="outline-chip outline-chip-lo">LOW</span>
				</Show>
				<Show when={task().completion_policy === "auto_children" && isChildful()}>
					<span
						class="outline-chip outline-chip-auto"
						title="completion_policy: auto_children — completes when all children are done"
					>
						auto ⚙
					</span>
				</Show>
				<Show when={(edge()?.blocked_count ?? 0) > 0}>
					<span class="outline-chip outline-chip-blocked" title="blocked by other open tasks">
						⛓ {edge()?.blocked_count}
					</span>
				</Show>
				<Show when={edge()?.ready}>
					<span class="outline-chip outline-chip-ready">ready</span>
				</Show>
				<Show when={edge()?.hook}>
					<span class="outline-chip outline-chip-hook" title="a hook is subscribed to this node's completion">
						⚡ hook
					</span>
				</Show>
				<Show when={edge()?.stale}>
					<span
						class="outline-chip outline-chip-stale"
						title="an open child was added after this node auto-completed (sticky semantics)"
					>
						stale
					</span>
				</Show>
				<Show when={task().claimed_by && task().progress !== "COMPLETED"}>
					<Badge variant="info">claimed · {task().claimed_by}</Badge>
				</Show>
			</span>

			<Show when={isChildful()}>
				<span class="outline-rollup-label">
					{props.store.rollups[task().id]?.subtree_done ?? 0}/{props.store.rollups[task().id]?.subtree_total ?? 0}
				</span>
			</Show>
		</div>
	);
}
