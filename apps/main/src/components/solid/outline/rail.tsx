import { getBrowserClient } from "@devpad/core/ui/client";
import type { Task, TaskLink } from "@devpad/schema";
import { external_ref } from "@devpad/schema";
import { createEffect, createSignal, For, Show } from "solid-js";
import { Ring } from "./ring";
import type { RollupCounts } from "./types";

type RailProps = {
	selectedTask: Task | null;
	/** Rollup cache from the outline store — lets a childful rail item render a real mini-ring instead of a plain dot when it's cached. */
	rollups: Partial<Record<string, RollupCounts>>;
	/** Travels within the outline (zooms to the node) — the rail's items never leave the page; "Open full editor" is the only real exit. */
	onNavigate: (id: string) => void;
};

type NearState = { links: TaskLink[]; tasksById: Partial<Record<string, Task>> };

const refLabel = (raw: unknown): string | null => {
	const parsed = external_ref.safeParse(raw);
	if (!parsed.success) return null;
	const ref = parsed.data;
	switch (ref.type) {
		case "pr":
			return `PR ${ref.url}`;
		case "commit":
			return `commit ${ref.sha.slice(0, 7)}`;
		case "file":
			return ref.path;
		case "doc":
			return `doc ${ref.doc_id}`;
		case "metric":
			return `metric ${ref.name}`;
		case "pipeline_run":
			return `run ${ref.run_id}`;
	}
};

/**
 * Connections rail (task B1.3): blocked-by / blocks / discovered-from /
 * references for the currently selected node, sourced entirely from
 * `tasks.near()` — no client-side edge-walking or business logic, just
 * grouping the wire response by kind + direction.
 */
export function Rail(props: RailProps) {
	const [near, setNear] = createSignal<NearState | null>(null);
	const [loading, setLoading] = createSignal(false);

	createEffect(() => {
		const task = props.selectedTask;
		if (!task) {
			setNear(null);
			return;
		}
		const id = task.id;
		setLoading(true);
		void getBrowserClient()
			.tasks.near(id)
			.then((result) => {
				// A fast reselect can land an earlier row's response after a later
				// one — drop it rather than overwrite the rail with stale data.
				if (props.selectedTask?.id !== id) return;
				if (!result.ok) {
					setNear({ links: [], tasksById: {} });
					return;
				}
				setNear({ links: result.value.links, tasksById: Object.fromEntries(result.value.tasks.map((t) => [t.id, t])) });
			})
			.finally(() => setLoading(false));
	});

	const section = (kind: TaskLink["kind"], direction: "src" | "dst") => {
		const state = near();
		const task = props.selectedTask;
		if (!state || !task) return [];
		return state.links
			.filter((l) => l.kind === kind && (direction === "src" ? l.dst_id === task.id : l.src_id === task.id))
			.map((l) => state.tasksById[direction === "src" ? l.src_id : (l.dst_id ?? "")])
			.filter((t): t is Task => t != null);
	};

	const references = () => {
		const state = near();
		const task = props.selectedTask;
		if (!state || !task) return [];
		return state.links.filter((l) => l.kind === "references" && l.src_id === task.id && l.ref != null);
	};

	return (
		<aside class="outline-rail">
			<Show when={props.selectedTask} fallback={<p class="outline-rail-empty">Select a row to see its connections.</p>}>
				{(task) => (
					<div class="outline-railcard" data-testid="outline-rail">
						<h2 class="outline-railcard-heading">connections</h2>
						<div class="outline-railcard-title">{task().title}</div>
						<div class="outline-railcard-id">
							#{task().id} · {task().kind}
							{task().completion_policy === "auto_children" ? " · auto_children" : ""}
						</div>

						<Show when={loading()}>
							<p class="outline-rail-empty">Loading…</p>
						</Show>

						<RailSection
							title="blocked by"
							items={section("blocks", "src")}
							rollups={props.rollups}
							onNavigate={props.onNavigate}
						/>
						<RailSection
							title="blocks"
							items={section("blocks", "dst")}
							rollups={props.rollups}
							onNavigate={props.onNavigate}
						/>
						<RailSection
							title="discovered from"
							items={section("discovered_from", "dst")}
							rollups={props.rollups}
							onNavigate={props.onNavigate}
						/>

						<Show when={references().length > 0}>
							<div class="outline-railsec">
								<h3>references</h3>
								<For each={references()}>
									{(link) => (
										<div class="outline-railitem">
											<span class="outline-chip outline-chip-ref">{refLabel(link.ref) ?? "ref"}</span>
										</div>
									)}
								</For>
							</div>
						</Show>

						<a class="outline-rail-open" href={`/todo/${task().id}`}>
							Open full editor →
						</a>
					</div>
				)}
			</Show>
		</aside>
	);
}

function RailSection(props: {
	title: string;
	items: Task[];
	rollups: Partial<Record<string, RollupCounts>>;
	onNavigate: (id: string) => void;
}) {
	return (
		<Show when={props.items.length > 0}>
			<div class="outline-railsec">
				<h3>{props.title}</h3>
				<For each={props.items}>
					{(item) => {
						const rollup = () => props.rollups[item.id];
						return (
							<button
								type="button"
								class="outline-railitem"
								onClick={() => {
									props.onNavigate(item.id);
								}}
							>
								<Show
									when={(rollup()?.subtree_total ?? 0) > 0}
									fallback={
										<span
											class={`outline-mini-dot${item.progress === "IN_PROGRESS" ? " outline-dot-doing" : item.progress === "COMPLETED" ? " outline-dot-done" : ""}`}
										/>
									}
								>
									<Ring
										rollup={rollup()}
										size={14}
										auto={item.completion_policy === "auto_children"}
										rippling={false}
									/>
								</Show>
								<span class="outline-railitem-title">{item.title}</span>
							</button>
						);
					}}
				</For>
			</div>
		</Show>
	);
}
