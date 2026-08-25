import { getBrowserClient } from "@devpad/core/ui/client";
import type { EdgeSummary, Milestone, RollupCounts } from "@devpad/api";
import type { Task } from "@devpad/schema";
import { createSignal, For, onMount, Show } from "solid-js";
import { Ring } from "../outline/ring";
import { LensShell } from "./lens-shell";

export type MilestoneLensProps = {
	projectId: string;
	onClose: () => void;
	/** Zooms the OUTLINE to a milestone or one of its descendants, and closes the lens. */
	onZoom: (id: string) => void;
};

type MilestoneRow = {
	milestone: Milestone;
	rollup: RollupCounts | undefined;
	edge: EdgeSummary | undefined;
	descendants: Task[];
};

/**
 * Task B2.2 — the milestone lens: Dagster-style collapsed phase cards,
 * ordered by rank (server-provided, same order the fold-era `after_id`
 * list used), each with a real rollup ring + stale/blocked badges from the
 * SAME `edge_summary`/`rollups` fields the outline's own rows use — no
 * client re-derivation. Replaces the deleted goals page's job as a lens,
 * not a destination.
 */
export default function MilestoneLens(props: MilestoneLensProps) {
	const [rows, setRows] = createSignal<MilestoneRow[]>([]);
	const [loading, setLoading] = createSignal(true);
	const [expanded, setExpanded] = createSignal<Set<string>>(new Set());

	onMount(() => void load());

	async function load(): Promise<void> {
		setLoading(true);
		const client = getBrowserClient();
		const list_result = await client.milestones.getByProject(props.projectId);
		if (!list_result.ok) {
			setRows([]);
			setLoading(false);
			return;
		}
		const milestones = list_result.value;
		const trees = await Promise.all(milestones.map((m) => client.tasks.tree(m.id, 2)));
		const built: MilestoneRow[] = milestones.map((m, i) => {
			const tree = trees[i];
			if (!tree?.ok) return { milestone: m, rollup: undefined, edge: undefined, descendants: [] };
			return {
				milestone: m,
				rollup: tree.value.rollups[m.id],
				edge: tree.value.edge_summary[m.id],
				descendants: tree.value.descendants,
			};
		});
		setRows(built);
		setLoading(false);
	}

	const toggle = (id: string) =>
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});

	const goto = (id: string) => {
		props.onZoom(id);
		props.onClose();
	};

	return (
		<LensShell title="Milestone lens" onClose={props.onClose}>
			<div class="lens-milestones">
				<Show when={!loading()} fallback={<p class="lens-graph-status">Loading milestones…</p>}>
					<Show when={rows().length > 0} fallback={<p class="lens-graph-status">No milestones yet.</p>}>
						<div class="lens-milestone-track">
							<For each={rows()}>
								{(row, i) => (
									<>
										<Show when={i() > 0}>
											<span class="lens-milestone-arrow" aria-hidden="true">
												→
											</span>
										</Show>
										<div class="lens-milestone-card" data-testid="lens-milestone-card" data-task-id={row.milestone.id}>
											<button type="button" class="lens-milestone-head" onClick={() => goto(row.milestone.id)}>
												<Ring rollup={row.rollup} size={26} auto={false} rippling={false} />
												<span class="lens-milestone-title">{row.milestone.name}</span>
											</button>
											<div class="lens-milestone-meta">
												<Show when={row.milestone.target_time}>
													{(target) => <span class="outline-chip">due {new Date(target()).toLocaleDateString()}</span>}
												</Show>
												<Show when={row.edge?.stale}>
													<span class="outline-chip outline-chip-stale">stale</span>
												</Show>
												<Show when={(row.edge?.blocked_count ?? 0) > 0}>
													<span class="outline-chip outline-chip-blocked">⛓ {row.edge?.blocked_count}</span>
												</Show>
												<Show when={(row.rollup?.subtree_total ?? 0) > 0}>
													<span class="outline-chip">
														{row.rollup?.subtree_done}/{row.rollup?.subtree_total} done
													</span>
												</Show>
											</div>
											<Show when={row.descendants.length > 0}>
												<button type="button" class="lens-milestone-expand" onClick={() => toggle(row.milestone.id)}>
													{expanded().has(row.milestone.id) ? "collapse" : `expand (${row.descendants.length})`}
												</button>
												<Show when={expanded().has(row.milestone.id)}>
													<ul class="lens-milestone-children">
														<For each={row.descendants}>
															{(child) => (
																<li>
																	<button type="button" class="lens-milestone-child" onClick={() => goto(child.id)}>
																		{child.title}
																	</button>
																</li>
															)}
														</For>
													</ul>
												</Show>
											</Show>
										</div>
									</>
								)}
							</For>
						</div>
					</Show>
				</Show>
			</div>
		</LensShell>
	);
}
